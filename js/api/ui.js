import { getSupabase } from "./client.js";

function buildInitials(name = "User") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function setText(elements, value) {
  elements.forEach((element) => {
    element.textContent = value;
  });
}

function getLevelInfo(xpValue, levelValue) {
  const xp = parseInt(xpValue, 10) || 0;
  const level = Number(levelValue) || Math.floor(xp / 500) + 1;
  const nextXp = Math.ceil(xp / 500) * 500 || 500;

  return { level, nextXp, xp };
}

export const ui = {
  async updateSidebar() {
    let name = localStorage.getItem("vs_user_name") || "User";
    let coins = localStorage.getItem("vs_coins") || "0";
    let xp = localStorage.getItem("vs_user_xp") || "0";
    let level = localStorage.getItem("vs_user_level") || "1";
    let initials = name !== "User" ? buildInitials(name) : "U";

    this.applySidebarUI(name, initials, coins, xp, level);

    try {
      const userId = localStorage.getItem("vs_user_id");

      if (!userId) {
        return;
      }

      const supabase = getSupabase();
      const [profileRes, balanceRes] = await Promise.all([
        supabase
          .from("users")
          .select("name, xp, level")
          .eq("id", userId)
          .single(),
        supabase.rpc("get_coin_balance"),
      ]);

      if (profileRes.data) {
        const profile = profileRes.data;
        name = profile.name || name;
        xp = String(profile.xp || 0);
        level = String(profile.level || 1);
        initials = buildInitials(name);
      }

      if (balanceRes.data !== null && balanceRes.data !== undefined) {
        coins = String(Number(balanceRes.data));
        localStorage.setItem("vs_coins", coins);
      }

      this.applySidebarUI(name, initials, coins, xp, level);
    } catch (error) {
      console.warn("Sidebar background sync failed:", error);
    }
  },

  applySidebarUI(name, initials, coins, xp, level) {
    setText(
      document.querySelectorAll(".sb-avatar, .xph-avatar, .user-menu .avatar"),
      initials,
    );
    setText(
      document.querySelectorAll(".sb-name, .xph-name, .user-menu .uname"),
      name,
    );

    const coinCount =
      document.getElementById("sb-coin-count") ||
      document.getElementById("coin-count");

    if (coinCount) {
      coinCount.textContent = coins;
    }

    const sidebarCoin = document.querySelector(".sb-coin");

    if (sidebarCoin && !coinCount) {
      sidebarCoin.innerHTML = `🪙 ${coins} coins`;
    }

    const levelInfo = getLevelInfo(xp, level);

    setText(
      document.querySelectorAll(".xph-level"),
      `Level ${levelInfo.level}`,
    );

    document.querySelectorAll(".xph-xp").forEach((xpElement) => {
      xpElement.textContent = `${levelInfo.xp} / ${levelInfo.nextXp} XP to Level ${Math.floor(levelInfo.xp / 500) + 1}`;
    });

    document.querySelectorAll(".xph-fill").forEach((bar) => {
      bar.style.width = `${((levelInfo.xp % 500) / 500) * 100}%`;
    });

    this.updateBadges();
  },

  async updateBadges() {
    const supabase = getSupabase();
    const userId = localStorage.getItem("vs_user_id");
    const { count: bountyCount } = await supabase
      .from("bounties")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");

    setText(
      document.querySelectorAll(
        'a[href="09_bounty.html"] .badge, a[href="09_bounty.html"] .bdg',
      ),
      String(bountyCount || 0),
    );

    if (!userId) {
      return;
    }

    const [{ count: sessionCount }, profile, { count: unreadCount }] =
      await Promise.all([
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "confirmed", "active"])
          .or(`learner_id.eq.${userId},teacher_id.eq.${userId}`),
        window.VS.profile.get(),
        supabase
          .from("direct_messages")
          .select("id", { count: "exact", head: true })
          .eq("receiver_id", userId)
          .eq("is_read", false),
      ]);

    setText(
      document.querySelectorAll(
        'a[href="11_my_sessions.html"] .badge, a[href="11_my_sessions.html"] .bdg',
      ),
      String(sessionCount || 0),
    );

    if (profile?.college_id) {
      const { count: campusCount } = await supabase
        .from("campus_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("college_id", profile.college_id);

      setText(
        document.querySelectorAll(
          'a[href="15_campus_collab.html"] .badge, #sb-campus-badge',
        ),
        String(campusCount || 0),
      );
    }

    document
      .querySelectorAll(
        'a[href="16_messages.html"] .badge, #sb-unread-count, #sb-unread-count-top',
      )
      .forEach((element) => {
        element.textContent = String(unreadCount || 0);
        element.style.display = unreadCount > 0 ? "block" : "none";
      });
  },
};
