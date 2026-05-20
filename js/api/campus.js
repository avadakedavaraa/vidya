/**
 * js/api/campus.js — Campus Collab (IRL Connect) feature.
 */
import { getSupabase, APIError } from "./client.js";

export const campus = {
  async list() {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("campus_requests")
      .select(
        `id, title, description, location_hint, treat_type, status, created_at, creator:creator_id(id, name, avatar_color)`,
      )
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (error) throw new APIError(error.message, 500);
    return data;
  },

  async post({ title, description, location_hint, treat_type, error_snippet }) {
    const sb = getSupabase();
    const userId = localStorage.getItem("vs_user_id");
    const { data: profileData, error: pErr } = await sb
      .from("users")
      .select("college")
      .eq("id", userId)
      .single();
    if (pErr) throw new APIError("Failed to fetch college constraint", 500);
    const { data, error } = await sb
      .from("campus_requests")
      .insert({
        creator_id: userId,
        college_id: profileData?.college || "Unknown College",
        title,
        description,
        location_hint,
        treat_type,
        error_snippet,
      })
      .select()
      .single();
    if (error) throw new APIError(error.message, 500);
    return data;
  },

  async accept(requestId) {
    const sb = getSupabase();
    const userId = localStorage.getItem("vs_user_id");
    const { data, error } = await sb
      .from("campus_requests")
      .update({ status: "accepted", helper_id: userId })
      .eq("id", requestId)
      .select("id, creator_id, title")
      .single();
    if (error) throw new APIError(error.message, 500);
    return data;
  },
};
