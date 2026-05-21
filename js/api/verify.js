/**
 * js/api/verify.js — Skill verification (MCQs) and scoring.
 */
import { getSupabase, APIError } from "./client.js";

export const verify = {
  async getQuestions(skillName, count = 10) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("mcq_questions")
      .select(
        "id, question, option_a, option_b, option_c, option_d, difficulty",
      )
      .eq("skill_name", skillName)
      .eq("is_active", true)
      .order("RANDOM()")
      .limit(count);
    if (error) throw new APIError(error.message, 500);
    return data ?? [];
  },

  async submitAttempt(skillName, answers) {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new APIError("Not authenticated", 401);
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 86400 * 1000,
    ).toISOString();
    const { count } = await supabase
      .from("skill_verifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("skill_name", skillName)
      .gte("started_at", thirtyDaysAgo);
    if ((count ?? 0) >= 3)
      throw new APIError("Maximum 3 attempts per skill per 30 days.", 429);

    const questionIds = answers.map((a) => a.question_id);
    const { data: questions } = await supabase
      .from("mcq_questions")
      .select("id, correct")
      .in("id", questionIds);
    const qMap = Object.fromEntries(
      (questions ?? []).map((q) => [q.id, q.correct]),
    );
    const correct = answers.filter(
      (a) => qMap[a.question_id] === a.selected_option,
    ).length;
    const pct = Math.round((correct / answers.length) * 100);
    const tier =
      pct >= 95 ? "gold" : pct >= 85 ? "silver" : pct >= 70 ? "bronze" : null;
    const passed = tier !== null;

    await supabase
      .from("skill_verifications")
      .insert({
        user_id: user.id,
        skill_name: skillName,
        score: correct,
        pct,
        tier_awarded: tier,
        passed,
        completed_at: new Date().toISOString(),
      });

    if (passed) {
      const { data: existingSkill } = await supabase
        .from("skills")
        .select("id, tier")
        .eq("user_id", user.id)
        .eq("name", skillName)
        .single();
      const tierRank = { bronze: 1, silver: 2, gold: 3 };
      const shouldUpgrade =
        !existingSkill || tierRank[tier] > (tierRank[existingSkill.tier] ?? 0);
      if (shouldUpgrade) {
        const coinRate = tier === "gold" ? 2.0 : tier === "silver" ? 1.5 : 1.0;
        if (existingSkill)
          await supabase
            .from("skills")
            .update({
              tier,
              coin_rate: coinRate,
              verified_at: new Date().toISOString(),
            })
            .eq("id", existingSkill.id);
        else
          await supabase
            .from("skills")
            .insert({
              user_id: user.id,
              name: skillName,
              tier,
              coin_rate: coinRate,
              is_teaching: true,
              verified_at: new Date().toISOString(),
              category: "programming",
            });
      }
    }
    return { correct, total: answers.length, pct, tier, passed };
  },
};

export const mcqs = {
  async list(skillName) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("get_mcq_questions", {
      p_skill_name: skillName,
    });
    if (error) throw new APIError("Failed to load questions.", 400);
    return data.map((q) => ({
      id: q.id,
      q: q.question,
      opts: [q.option_a, q.option_b, q.option_c, q.option_d].map(
        (o) => (o != null && String(o).trim()) || "—",
      ),
    }));
  },
  async verify(skillName, answersPayload, timeTakenS) {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("verify_mcq_answers", {
      p_skill_name: skillName,
      p_answers: answersPayload,
      p_time_taken_s: timeTakenS,
    });
    if (error) throw new APIError("Verification failed: " + error.message, 400);
    return data;
  },
};
