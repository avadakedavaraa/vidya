// supabase/functions/verify-otp/index.ts
// Verifies the submitted OTP against the stored hash.
// On success: creates the Supabase Auth user (signup) or returns session (login).
// Max 5 wrong attempts per token before it's voided.

import {
  handleOptions, ok, err,
  adminClient, rateLimit,
  validateEmail, sanitizeText, validateUUID,
  creditCoins
} from './_shared/utils';

export const config = { runtime: 'edge' };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  const email   = sanitizeText(body.email, 254).toLowerCase();
  const otp     = sanitizeText(body.otp, 6);
  const purpose = body.purpose as string;

  // ─── Input validation ────────────────────────────────────
  if (!validateEmail(email))  return err('Invalid email', req, 400);
  if (!/^\d{6}$/.test(otp))   return err('OTP must be 6 digits', req, 400);
  if (!['signup','login','reset_password'].includes(purpose)) {
    return err('Invalid purpose', req, 400);
  }

  // ─── Rate limit: 10 verify attempts per email per 30 min ─
  const limited = await rateLimit(`verify:${email}`, 'verify_otp', 10, 1800);
  if (limited) {
    return err('Too many attempts. Please request a new OTP.', req, 429);
  }

  // ─── Hash the submitted OTP the same way send-otp did ────
  const encoder    = new TextEncoder();
  const data       = encoder.encode(otp + email);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex    = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // ─── Look up active OTP record ───────────────────────────
  const db = adminClient();
  const { data: tokenRow, error: fetchErr } = await db
    .from('otp_tokens')
    .select('id, token_hash, attempts, expires_at, used_at')
    .eq('email', email)
    .eq('purpose', purpose)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) {
    console.error('OTP fetch error:', fetchErr);
    return err('Verification failed. Try again.', req, 500);
  }
  if (!tokenRow) return err('OTP expired or not found. Request a new one.', req, 400);

  // ─── Increment attempt counter before comparing ───────────
  await db.from('otp_tokens')
    .update({ attempts: tokenRow.attempts + 1 })
    .eq('id', tokenRow.id);

  // Max 5 wrong attempts → void the token
  if (tokenRow.attempts >= 5) {
    await db.from('otp_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRow.id);
    return err('Too many wrong attempts. Request a new OTP.', req, 400);
  }

  // ─── Compare hash ────────────────────────────────────────
  if (hashHex !== tokenRow.token_hash) {
    const remaining = 5 - (tokenRow.attempts + 1);
    return err(`Incorrect OTP. ${remaining} attempts remaining.`, req, 400);
  }

  // ─── Mark token as used ──────────────────────────────────
  await db.from('otp_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  // ─── Handle purpose ──────────────────────────────────────
  if (purpose === 'signup') {
    return await handleSignup(email, body, db, req);
  } else if (purpose === 'login') {
    return await handleLogin(email, db, req);
  } else {
    // reset_password: return a short-lived reset token
    const resetToken = crypto.randomUUID();
    // Store reset token (reuse OTP table with purpose='reset_password')
    await db.from('otp_tokens').insert({
      email,
      token_hash: resetToken,
      purpose:    'reset_password',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    return ok({ success: true, reset_token: resetToken }, req);
  }
});

// ─── Signup: create auth user + profile + welcome bonus ──────
async function handleSignup(
  email: string,
  body:  Record<string, unknown>,
  db:    ReturnType<typeof adminClient>,
  req:   Request
) {
  const name    = sanitizeText(body.name    as string ?? '', 80) || 'User';
  const college = sanitizeText(body.college as string ?? '', 100);
  const role    = ['learner','teacher','both'].includes(body.role as string)
                    ? (body.role as string) : 'both';

  // Check if user already exists
  const { data: existing } = await db.auth.admin.listUsers();
  const alreadyExists = existing?.users?.some(u => u.email === email);
  if (alreadyExists) return err('Account already exists. Please sign in.', req, 409);

  // Create Supabase Auth user (email confirmed = true since OTP verified)
  const tempPassword = crypto.randomUUID() + 'Vs!'; // random strong password
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email,
    password:       tempPassword,
    email_confirm:  true,
    user_metadata:  { name, college, role },
  });

  if (authErr || !authData.user) {
    console.error('Auth user creation failed:', authErr);
    return err('Account creation failed. Try again.', req, 500);
  }

  const userId = authData.user.id;

  // Insert into public.users
  const { error: profileErr } = await db.from('users').insert({
    id:      userId,
    name,
    email,
    college: college || null,
    role,
  });
  if (profileErr) {
    console.error('Profile insert failed:', profileErr);
    // Cleanup: delete auth user to keep DB consistent
    await db.auth.admin.deleteUser(userId);
    return err('Profile creation failed. Try again.', req, 500);
  }

  // Award welcome bonus: 2 coins
  await creditCoins(userId, 2, 'welcome_bonus', undefined, undefined, 'Welcome to Vidyasetu!');

  // Create a session for the new user
  const { data: session, error: sessionErr } = await db.auth.admin.generateLink({
    type:  'magiclink',
    email,
  });

  // Return minimal info — client will use signInWithPassword or similar
  return ok({
    success:   true,
    user_id:   userId,
    name,
    email,
    role,
    coins:     2,
    message:   'Account created successfully!',
  }, req, 201);
}

// ─── Login: return Supabase session ──────────────────────────
async function handleLogin(
  email: string,
  db:    ReturnType<typeof adminClient>,
  req:   Request
) {
  // Get user from auth
  const { data: { users }, error } = await db.auth.admin.listUsers();
  if (error) return err('Login failed. Try again.', req, 500);

  const authUser = users.find(u => u.email === email);
  if (!authUser) return err('No account found for this email.', req, 404);

  if (authUser.banned_until) return err('Your account has been suspended.', req, 403);

  // Fetch profile
  const { data: profile } = await db
    .from('users')
    .select('id, name, role, college, xp, level, streak_days')
    .eq('id', authUser.id)
    .single();

  // Get coin balance
  const { data: balance } = await db
    .rpc('get_coin_balance', { p_user_id: authUser.id });

  // Update last_active_at
  await db.from('users')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', authUser.id);

  return ok({
    success:  true,
    user_id:  authUser.id,
    email:    authUser.email,
    name:     profile?.name     ?? 'User',
    role:     profile?.role     ?? 'both',
    xp:       profile?.xp       ?? 0,
    level:    profile?.level    ?? 1,
    coins:    Number(balance ?? 0),
    message:  'Signed in successfully!',
  }, req);
}
