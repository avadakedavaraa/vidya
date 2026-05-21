import { creditCoins, rateLimit } from "./_shared/ledger";
import { hashOtp } from "./_shared/otp";
import { handleOptions, ok, err } from "./_shared/responses";
import { adminClient } from "./_shared/supabase";
import { sanitizeText, validateEmail } from "./_shared/validation";

export const config = { runtime: "edge" };

export default async function (req: Request) {
  const preflight = handleOptions(req);

  if (preflight) return preflight;
  if (req.method !== "POST") return err("Method not allowed", req, 405);

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", req, 400);
  }

  const email = sanitizeText(body.email, 254).toLowerCase();
  const otp = sanitizeText(body.otp, 6);
  const purpose = body.purpose as string;

  if (!validateEmail(email)) return err("Invalid email", req, 400);
  if (!/^\d{6}$/.test(otp)) return err("OTP must be 6 digits", req, 400);
  if (!["signup", "login", "reset_password"].includes(purpose)) {
    return err("Invalid purpose", req, 400);
  }

  const limited = await rateLimit(`verify:${email}`, "verify_otp", 10, 1800);

  if (limited) {
    return err("Too many attempts. Please request a new OTP.", req, 429);
  }

  const hashHex = await hashOtp(email, otp);
  const db = adminClient();
  const { data: tokenRow, error: fetchError } = await db
    .from("otp_tokens")
    .select("id, token_hash, attempts, expires_at, used_at")
    .eq("email", email)
    .eq("purpose", purpose)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    return err("Verification failed. Try again.", req, 500);
  }

  if (!tokenRow) {
    return err("OTP expired or not found. Request a new one.", req, 400);
  }

  await db
    .from("otp_tokens")
    .update({ attempts: tokenRow.attempts + 1 })
    .eq("id", tokenRow.id);

  if (tokenRow.attempts >= 5) {
    await db
      .from("otp_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    return err("Too many wrong attempts. Request a new OTP.", req, 400);
  }

  if (hashHex !== tokenRow.token_hash) {
    return err(
      `Incorrect OTP. ${5 - (tokenRow.attempts + 1)} attempts remaining.`,
      req,
      400,
    );
  }

  await db
    .from("otp_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  if (purpose === "signup") {
    return handleSignup(email, body, db, req);
  }

  if (purpose === "login") {
    return handleLogin(email, db, req);
  }

  const resetToken = crypto.randomUUID();

  await db.from("otp_tokens").insert({
    email,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    purpose: "reset_password",
    token_hash: resetToken,
  });

  return ok({ reset_token: resetToken, success: true }, req);
}

async function handleSignup(
  email: string,
  body: Record<string, unknown>,
  db: ReturnType<typeof adminClient>,
  req: Request,
) {
  const name = sanitizeText((body.name as string) ?? "", 80) || "User";
  const college = sanitizeText((body.college as string) ?? "", 100);
  const role = ["learner", "teacher", "both"].includes(body.role as string)
    ? (body.role as string)
    : "both";

  const { data: existing } = await db.auth.admin.listUsers();

  if (existing?.users?.some((user: any) => user.email === email)) {
    return err("Account already exists. Please sign in.", req, 409);
  }

  const tempPassword = `${crypto.randomUUID()}Vs!`;
  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: tempPassword,
    user_metadata: { college, name, role },
  });

  if (authError || !authData.user) {
    return err("Account creation failed. Try again.", req, 500);
  }

  const userId = authData.user.id;
  const { error: profileError } = await db.from("users").insert({
    college: college || null,
    email,
    id: userId,
    name,
    role,
  });

  if (profileError) {
    await db.auth.admin.deleteUser(userId);
    return err("Profile creation failed. Try again.", req, 500);
  }

  await creditCoins(
    userId,
    2,
    "welcome_bonus",
    undefined,
    undefined,
    "Welcome to Vidyasetu!",
  );
  await db.auth.admin.generateLink({ email, type: "magiclink" });

  return ok(
    {
      coins: 2,
      email,
      message: "Account created successfully!",
      name,
      role,
      success: true,
      user_id: userId,
    },
    req,
    201,
  );
}

async function handleLogin(
  email: string,
  db: ReturnType<typeof adminClient>,
  req: Request,
) {
  const {
    data: { users },
    error,
  } = await db.auth.admin.listUsers();

  if (error) {
    return err("Login failed. Try again.", req, 500);
  }

  const authUser = users.find((user: any) => user.email === email);

  if (!authUser) {
    return err("No account found for this email.", req, 404);
  }

  if (authUser.banned_until) {
    return err("Your account has been suspended.", req, 403);
  }

  const { data: profile } = await db
    .from("users")
    .select("id, name, role, college, xp, level, streak_days")
    .eq("id", authUser.id)
    .single();
  const { data: balance } = await db.rpc("get_coin_balance", {
    p_user_id: authUser.id,
  });

  await db
    .from("users")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", authUser.id);

  return ok(
    {
      coins: Number(balance ?? 0),
      email: authUser.email,
      level: profile?.level ?? 1,
      message: "Signed in successfully!",
      name: profile?.name ?? "User",
      role: profile?.role ?? "both",
      success: true,
      user_id: authUser.id,
      xp: profile?.xp ?? 0,
    },
    req,
  );
}
