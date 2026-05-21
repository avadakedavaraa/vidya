/**
 * js/api/profile.js — User profile and leaderboard.
 */
import { getSupabase, APIError } from "./client.js";

export const profile = {
  async get() {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const [{ data: p }, { data: skills }, { data: badges }] = await Promise.all(
      [
        supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("skills").select("*").eq("user_id", user.id),
        supabase.from("user_badges").select("*").eq("user_id", user.id),
      ],
    );
    const result = {
      ...p,
      id: user.id,
      email: user.email,
      skills: skills ?? [],
      badges: badges ?? [],
    };
    if (p?.name) localStorage.setItem("vs_user_name", p.name);
    return result;
  },

  async update(fields) {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new APIError("Not authenticated", 401);
    const { error } = await supabase
      .from("users")
      .update(fields)
      .eq("id", user.id);
    if (error) throw new APIError(error.message, 500);
  },

  async delete() {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new APIError("Not authenticated", 401);
    const { error } = await supabase.from("users").delete().eq("id", user.id);
    if (error) throw new APIError(error.message, 500);
    window.VS.auth.logout();
  },
};

export const leaderboard = {
  async get(period = "weekly", limit = 20) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("get_leaderboard", {
      p_period: period,
      p_limit: limit,
    });
    if (error) throw new APIError(error.message, 500);
    const userId = localStorage.getItem("vs_user_id");
    return (data || []).map((p) => ({
      ...p,
      av: (p.name || "U")
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase(),
      bg: p.avatar_color || "var(--indigo)",
      sub: p.college || `Level ${p.level || 1}`,
      me: p.user_id === userId,
    }));
  },
};
