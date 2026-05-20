/**
 * js/api/quests.js — Quest listing, claiming, and dashboard helpers.
 */
import { getSupabase, edgeFn, APIError } from "./client.js";

export const quests = {
  async list() {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [{ data: questData }, { data: progress }] = await Promise.all([
      supabase.from("quests").select("*").eq("is_active", true).order("type"),
      supabase
        .from("user_quest_progress")
        .select("*")
        .eq("user_id", user.id)
        .gte("period_start", today.toISOString()),
    ]);
    return (questData ?? []).map((q) => {
      const p = (progress ?? []).find((x) => x.quest_id === q.id);
      return {
        ...q,
        progress: p?.progress ?? 0,
        completed: p?.completed ?? false,
        claimed: p?.claimed ?? false,
      };
    });
  },

  async claim(questId) {
    const result = await edgeFn("claim-quest", { quest_id: questId });
    if (result) {
      const currentCoins = parseInt(localStorage.getItem("vs_coins") || "0");
      localStorage.setItem(
        "vs_coins",
        String(currentCoins + Number(result.coins_awarded ?? 0)),
      );
    }
    return result;
  },

  async getAll() {
    const list = await quests.list().catch(() => []);
    return list.map((q) => ({
      id: q.id,
      type: q.type,
      icon: q.type === "daily" ? "📅" : "🎯",
      iconBg: q.type === "daily" ? "var(--teal-light)" : "var(--indigo-light)",
      title: q.title,
      desc: q.description || "",
      xp: 0,
      coins: q.coin_reward || q.coins,
      progress: q.progress || 0,
      target: q.target_count || q.target,
      done: q.completed || q.done,
    }));
  },
};
