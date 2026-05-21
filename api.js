import { getSupabase } from "./js/api/client.js";
import { auth } from "./js/api/auth.js";
import { coins, transactions } from "./js/api/coins.js";
import { teachers } from "./js/api/teachers.js";
import { sessions } from "./js/api/sessions.js";
import { bounties } from "./js/api/bounties.js";
import { quests } from "./js/api/quests.js";
import { profile, leaderboard } from "./js/api/profile.js";
import { dm, chat } from "./js/api/messages.js";
import { matchmaking } from "./js/api/matchmaking.js";
import { verify, mcqs } from "./js/api/verify.js";
import { campus } from "./js/api/campus.js";
import { ui } from "./js/api/ui.js";
import { jitsi } from "./js/api/jitsi.js";

function buildInitials(name = "Unknown") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function getFallbackTeacher(id) {
  const teacherList = await window.VS.teachers.getAll().catch(() => []);
  return teacherList.find((teacher) => teacher.id === id) || null;
}

async function getTeacher(id) {
  if (!id) {
    return null;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("users")
      .select(
        "id,name,college,avatar_color,bio,xp,level,last_active_at,skills(*)",
      )
      .eq("id", id)
      .eq("is_banned", false)
      .single();

    if (error || !data) {
      throw new Error("Teacher not found");
    }

    const primarySkill =
      (data.skills || []).find((skill) => skill.is_teaching) ||
      data.skills?.[0] ||
      {};
    const teacherName = data.name || "Unknown";
    const stats = await window.VS.teachers.getStats(id).catch(() => ({
      avgRating: 0,
      reviewsCount: 0,
      totalSessions: 0,
    }));

    return {
      bio: data.bio || "",
      category: primarySkill.category || "other",
      college: data.college || "Verified Student",
      color: data.avatar_color || "#5B45E0",
      completion_rate: 100,
      id: data.id,
      initials: buildInitials(teacherName),
      level: data.level || 1,
      name: teacherName,
      online:
        new Date(data.last_active_at) > new Date(Date.now() - 15 * 60_000),
      rate: primarySkill.coin_rate || 1.0,
      rating: stats.avgRating > 0 ? stats.avgRating : 0,
      reviews: stats.reviewsCount,
      reviews_count: stats.reviewsCount,
      sessions: stats.totalSessions,
      teaches: (data.skills || [])
        .filter((skill) => skill.is_teaching)
        .map((skill) => skill.name),
      tier: primarySkill.tier || "bronze",
      wants: [],
      xp: data.xp || 0,
    };
  } catch (error) {
    return getFallbackTeacher(id);
  }
}

async function getCurrentUser() {
  try {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return window.VS.auth.currentUser();
    }

    const { data: profileData } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profileData) {
      return window.VS.auth.currentUser();
    }

    const coinBalance = await window.VS.coins
      .balance()
      .catch(() => parseInt(localStorage.getItem("vs_coins") || "0", 10));
    const name = profileData.name || "User";

    return {
      avatar_color: profileData.avatar_color || "#5B45E0",
      coins: coinBalance,
      college: profileData.college || "",
      email: user.email,
      game_progress: profileData.game_progress || {},
      id: profileData.id,
      initials: buildInitials(name),
      level: profileData.level || 1,
      name,
      xp: profileData.xp || 0,
    };
  } catch (error) {
    return window.VS.auth.currentUser();
  }
}

function watchCoins(onUpdate) {
  const supabase = getSupabase();
  const userId = localStorage.getItem("vs_user_id");

  return supabase
    .channel(`coins:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        filter: `user_id=eq.${userId}`,
        schema: "public",
        table: "coin_ledger",
      },
      async (payload) => {
        const newBalance = await window.VS.coins.balance();

        if (onUpdate) {
          onUpdate(newBalance, payload.new);
        }
      },
    )
    .subscribe();
}

window.getSupabase = getSupabase;

window.VS = {
  auth,
  bounties,
  campus,
  chat,
  coins,
  dm,
  leaderboard,
  matchmaking,
  mcqs,
  profile,
  quests,
  sessions,
  teachers,
  transactions,
  ui,
  verify,
  watchCoins,
  jitsi,

  api: {
    getCurrentUser,
    getTeacher,
  },
};

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (window.VS && window.VS.ui) {
      window.VS.ui.updateSidebar();
    }
  });
}
