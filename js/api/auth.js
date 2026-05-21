import { getSupabase, APIError } from "./client.js";

const SESSION_KEYS = [
  "vs_logged_in",
  "vs_user_id",
  "vs_coins",
  "vs_user_name",
  "vs_user_role",
  "vs_user_level",
  "vs_user_xp",
  "vs_demo_mode",
];

function clearSessionSnapshot() {
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
}

function getDisplayName(email, fallback = "User") {
  if (!email) {
    return fallback;
  }

  return email.split("@")[0] || fallback;
}

function saveSessionSnapshot({ coins = 0, id, loggedIn = true, name }) {
  localStorage.setItem("vs_logged_in", String(loggedIn));
  localStorage.setItem("vs_user_id", id);
  localStorage.setItem("vs_user_name", name);
  localStorage.setItem("vs_coins", String(Number(coins ?? 0)));
}

async function getCoinBalance(supabase, userId) {
  const result = userId
    ? await supabase.rpc("get_coin_balance", { p_user_id: userId })
    : await supabase.rpc("get_coin_balance");
  const { data } = result;
  return Number(data ?? 0);
}

export const auth = {
  async getSession() {
    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  },

  async getUser() {
    const supabase = getSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  },

  logout() {
    clearSessionSnapshot();

    const supabase = getSupabase();
    supabase.auth.signOut().finally(() => {
      localStorage.clear();
      window.location.href = "index.html";
    });
  },

  signOut() {
    return this.logout();
  },

  async requireLogin() {
    const loggedIn = localStorage.getItem("vs_logged_in") === "true";

    if (!loggedIn) {
      const redirect = encodeURIComponent(window.location.pathname);
      window.location.href = `02_login.html?redirect=${redirect}`;
      return false;
    }

    return true;
  },

  isLoggedIn() {
    return localStorage.getItem("vs_logged_in") === "true";
  },

  currentUser() {
    const name = localStorage.getItem("vs_user_name") || "User";
    const id = localStorage.getItem("vs_user_id");
    const coins = parseInt(localStorage.getItem("vs_coins") || "0", 10);

    if (!id) {
      return null;
    }

    return {
      coins,
      email: "",
      id,
      name,
    };
  },

  async loginWithPassword(email, password) {
    const supabase = getSupabase();
    const normalizedEmail = email.toLowerCase().trim();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      throw new APIError(error.message, error.status || 400);
    }

    const user = data?.user;

    if (!user) {
      throw new APIError("Login failed.", 400);
    }

    const { data: profile } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    const name = profile?.name ?? getDisplayName(user.email);
    const coins = await getCoinBalance(supabase);

    saveSessionSnapshot({
      coins,
      id: user.id,
      name,
    });

    return {
      coins,
      id: user.id,
      name: profile?.name,
      success: true,
    };
  },

  async signupWithPassword(email, password, extra = {}) {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      options: { data: extra },
      password,
    });

    if (error) {
      if (error.message?.toLowerCase().includes("already registered")) {
        throw new APIError(
          "This email is already registered. Please sign in instead.",
          409,
        );
      }

      throw new APIError(
        error.message || "Signup failed.",
        error.status || 400,
      );
    }

    return { success: true };
  },

  async verifyOTP(email, otp, purpose = "signup", extra = {}) {
    const supabase = getSupabase();
    const normalizedEmail = email.toLowerCase().trim();
    const otpType =
      purpose === "signup" || purpose === "login" ? "signup" : "recovery";
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: otp.trim(),
      type: otpType,
    });

    if (error) {
      throw new APIError(error.message, error.status || 400);
    }

    const user = data?.user;

    if (!user) {
      throw new APIError("Verification failed.", 400);
    }

    if (purpose === "signup") {
      await supabase
        .from("users")
        .update({
          name: extra.name || getDisplayName(user.email),
          role: extra.role || "both",
        })
        .eq("id", user.id);
    }

    const { data: profile } = await supabase
      .from("users")
      .select("name, coins")
      .eq("id", user.id)
      .maybeSingle();
    const name = profile?.name ?? extra.name ?? getDisplayName(user.email);
    const coins = profile?.coins ?? 2;

    saveSessionSnapshot({
      coins,
      id: user.id,
      name,
    });

    return {
      coins,
      id: user.id,
      name: profile?.name,
      success: true,
    };
  },

  async sendOTP(email, purpose = "login") {
    const supabase = getSupabase();
    const normalizedEmail = email.toLowerCase().trim();

    if (purpose === "reset_password") {
      const { error } =
        await supabase.auth.resetPasswordForEmail(normalizedEmail);

      if (error) {
        throw new APIError(error.message, error.status || 400);
      }
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: purpose === "signup" },
      });

      if (error) {
        throw new APIError(error.message, error.status || 400);
      }
    }

    return { success: true };
  },

  async updatePassword(newPassword) {
    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      throw new APIError(error.message, error.status || 400);
    }

    return { success: true };
  },

  async loginWithGoogle(redirectAfter = "03_dashboard.html") {
    const supabase = getSupabase();
    const origin = window.location.origin;
    let callbackUrl =
      origin +
      "/02_login.html?auth_callback=1&redirect=" +
      encodeURIComponent(redirectAfter);

    if (!origin || origin === "null" || origin === "file://") {
      callbackUrl =
        window.APP_CONFIG.SUPABASE_URL +
        "/02_login.html?auth_callback=1&redirect=" +
        encodeURIComponent(redirectAfter);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      options: {
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: callbackUrl,
        skipBrowserRedirect: false,
      },
      provider: "google",
    });

    if (error) {
      throw new APIError(error.message, error.status || 400);
    }
  },

  async handleOAuthCallback() {
    const supabase = getSupabase();
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const hasCallback = params.get("auth_callback") === "1";
    const hasHashToken = hash.includes("access_token=");
    const hasHashError = hash.includes("error=");
    const { data: existingSession } = await supabase.auth.getSession();
    const justLoggedIn =
      existingSession?.session &&
      !localStorage.getItem("vs_logged_in") &&
      existingSession.session.user?.app_metadata?.provider === "google";

    if (!hasCallback && !hasHashToken && !hasHashError && !justLoggedIn) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !data?.session) {
      if (hasHashError) {
        const errorMatch = hash.match(/error_description=([^&]+)/);

        if (errorMatch) {
          console.error("OAuth error:", decodeURIComponent(errorMatch[1]));
        }
      }

      return;
    }

    const user = data.session.user;
    const googleName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      getDisplayName(user.email);

    await supabase.from("users").upsert(
      {
        avatar_color: "#5B45E0",
        email: user.email,
        id: user.id,
        name: googleName,
        role: "both",
      },
      { onConflict: "id" },
    );
    await supabase.from("coin_ledger").insert({
      amount: 2,
      note: "Welcome to Vidyasetu! 🎉",
      type: "welcome_bonus",
      user_id: user.id,
    });

    const { data: profile } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();
    const coinBalance = await getCoinBalance(supabase, user.id).catch(() => 2);

    saveSessionSnapshot({
      coins: coinBalance,
      id: user.id,
      name: profile?.name ?? googleName,
    });

    if (window.history?.replaceState) {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname + window.location.search,
      );
    }

    window.location.replace(params.get("redirect") || "03_dashboard.html");
  },
};
