import { getSupabase, APIError } from "./client.js";

function toNumber(value) {
  return Number(value ?? 0);
}

function formatLedgerDate(createdAt) {
  const date = new Date(createdAt);

  return `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export const coins = {
  async balance() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("get_coin_balance");

    if (error) {
      throw new APIError(error.message, 500);
    }

    const balance = toNumber(data);
    localStorage.setItem("vs_coins", String(balance));

    document.querySelectorAll("[data-coin-balance]").forEach((element) => {
      element.textContent = String(balance);
    });

    return balance;
  },

  async history({ type = null, limit = 20, offset = 0 } = {}) {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return [];
    }

    const { data, error } = await supabase.rpc("get_wallet_history", {
      p_limit: limit,
      p_offset: offset,
      p_type: type,
      p_user_id: user.id,
    });

    if (error) {
      throw new APIError(error.message, 500);
    }

    return data ?? [];
  },

  async getStats() {
    const supabase = getSupabase();
    const userId = localStorage.getItem("vs_user_id");

    if (!userId) {
      return null;
    }

    const now = new Date();
    const firstDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).toISOString();

    try {
      const [monthRes, totalRes, escrowRes] = await Promise.all([
        supabase
          .from("coin_ledger")
          .select("amount")
          .eq("user_id", userId)
          .gte("created_at", firstDay),
        supabase
          .from("coin_ledger")
          .select("amount")
          .eq("user_id", userId)
          .gt("amount", 0),
        supabase
          .from("bookings")
          .select("escrow_amount, released_amount")
          .eq("learner_id", userId)
          .in("status", ["confirmed", "active"]),
      ]);

      let monthEarned = 0;
      let monthSpent = 0;

      (monthRes.data || []).forEach((transaction) => {
        const amount = toNumber(transaction.amount);

        if (amount > 0) {
          monthEarned += amount;
        } else {
          monthSpent += Math.abs(amount);
        }
      });

      let totalEarnedEver = 0;

      (totalRes.data || []).forEach((transaction) => {
        totalEarnedEver += toNumber(transaction.amount);
      });

      let inEscrow = 0;

      (escrowRes.data || []).forEach((booking) => {
        inEscrow +=
          toNumber(booking.escrow_amount) - toNumber(booking.released_amount);
      });

      return { inEscrow, monthEarned, monthSpent, totalEarnedEver };
    } catch (error) {
      console.error("getStats failed:", error);
      return {
        inEscrow: 0,
        monthEarned: 0,
        monthSpent: 0,
        totalEarnedEver: 0,
      };
    }
  },

  async add(amount, note = "Game reward") {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("claim_game_reward", {
      p_amount: Number(amount),
      p_lang: "game",
      p_level: 1,
      p_note: note,
    });

    if (error) {
      throw new APIError(error.message, 500);
    }

    const newBalance = toNumber(data);
    localStorage.setItem("vs_coins", String(newBalance));
    return newBalance;
  },
};

export const transactions = {
  async getAll() {
    const userId = localStorage.getItem("vs_user_id");

    if (!userId) {
      return [];
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("coin_ledger")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return data.map((transaction) => {
      let icon = "🪙";

      if (transaction.type === "quest_reward") icon = "🎮";
      else if (transaction.type === "welcome_bonus") icon = "🎁";
      else if (transaction.type.includes("session")) icon = "📚";
      else if (transaction.type.includes("bounty")) icon = "🎯";

      return {
        amount: Math.abs(transaction.amount),
        date: formatLedgerDate(transaction.created_at),
        icon,
        raw_type: transaction.type,
        title: transaction.note || transaction.type.replace(/_/g, " "),
        type: transaction.amount > 0 ? "plus" : "minus",
      };
    });
  },
};
