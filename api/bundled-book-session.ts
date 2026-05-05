// api/book-session.ts
// Creates a booking and atomically locks coins in escrow.
// Validates: slot availability, learner balance, no double-booking, no self-booking.

import { handleOptions, ok, err } from './_shared/responses';
import { adminClient } from './_shared/supabase';
import { requireAuth, AuthError } from './_shared/auth';
import { rateLimit, debitCoins } from './_shared/ledger';
import { sanitizeText, validateUUID } from './_shared/validation';



export const config = { runtime: 'edge' };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  // ─── Auth ───────────────────────────────────────────────
  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401);
  }

  // ─── Rate limit: 10 bookings per user per hour ─────────
  const limited = await rateLimit(`book:${user.id}`, 'book_session', 10, 3600);
  if (limited) return err('Too many booking attempts. Please wait.', req, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  // ─── Validate inputs ───────────────────────────────────
  const teacherId    = body.teacher_id as string;
  const skillName    = sanitizeText(body.skill_name   as string ?? '', 80);
  const topic        = sanitizeText(body.topic        as string ?? '', 100);
  const note         = sanitizeText(body.note         as string ?? '', 500);
  const scheduledDate = body.scheduled_date as string;  // 'YYYY-MM-DD'
  const startTime    = body.start_time as string;       // 'HH:MM'
  const durationMins = Number(body.duration_mins);
  const coinRate     = Number(body.coin_rate);

  if (!validateUUID(teacherId))           return err('Invalid teacher ID', req, 400);
  if (teacherId === user.id)              return err('You cannot book yourself', req, 400);
  if (!skillName)                         return err('Skill name is required', req, 400);
  if (!scheduledDate || !startTime)       return err('Date and time are required', req, 400);
  if (![60, 90, 120, 180].includes(durationMins)) {
    return err('Duration must be 60, 90, 120, or 180 minutes', req, 400);
  }
  if (coinRate <= 0 || coinRate > 10)     return err('Invalid coin rate', req, 400);

  // ─── Calculate escrow ──────────────────────────────────
  const escrowAmount = +(coinRate * (durationMins / 60)).toFixed(1);
  if (escrowAmount <= 0) return err('Escrow amount must be positive', req, 400);

  // ─── Date validation ───────────────────────────────────
  const bookingDateTime = new Date(`${scheduledDate}T${startTime}:00`);
  if (bookingDateTime <= new Date()) {
    return err('Booking must be in the future', req, 400);
  }

  const db = adminClient();

  // ─── Check teacher exists and is not banned ────────────
  const { data: teacher, error: teacherErr } = await db
    .from('users')
    .select('id, name, is_banned')
    .eq('id', teacherId)
    .single();

  if (teacherErr || !teacher) return err('Teacher not found', req, 404);
  if (teacher.is_banned)      return err('This teacher account is currently unavailable', req, 400);

  // ─── Check learner has enough coins ────────────────────
  const { data: balanceData } = await db
    .rpc('get_coin_balance', { p_user_id: user.id });
  const balance = Number(balanceData ?? 0);

  if (balance < escrowAmount) {
    return err(
      `Insufficient coins. You have ${balance} coins but need ${escrowAmount}.`,
      req, 400
    );
  }

  // ─── Check no conflicting bookings for teacher ─────────
  const { count: conflict } = await db
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('teacher_id', teacherId)
    .eq('scheduled_date', scheduledDate)
    .neq('status', 'cancelled')
    .neq('status', 'refunded')
    .lte('start_time', startTime)
    .gte('start_time', startTime);

  if ((conflict ?? 0) > 0) {
    return err('This time slot is no longer available. Please choose another.', req, 409);
  }

  // ─── Create booking ────────────────────────────────────
  const { data: booking, error: bookingErr } = await db
    .from('bookings')
    .insert({
      learner_id:         user.id,
      teacher_id:         teacherId,
      skill_name:         skillName,
      topic:              topic || null,
      note_from_learner:  note  || null,
      scheduled_date:     scheduledDate,
      start_time:         startTime,
      duration_mins:      durationMins,
      coin_rate:          coinRate,
      escrow_amount:      escrowAmount,
      status:             'confirmed',
    })
    .select('id, scheduled_date, start_time, duration_mins, escrow_amount')
    .single();

  if (bookingErr || !booking) {
    console.error('Booking insert failed:', bookingErr);
    return err('Booking failed. Please try again.', req, 500);
  }

  // ─── Lock coins in escrow (atomic ledger debit) ────────
  try {
    await debitCoins(
      user.id,
      escrowAmount,
      'escrow_lock',
      booking.id,
      'booking',
      `Escrow for session with ${teacher.name}`
    );
  } catch (coinErr) {
    // Rollback: cancel the booking
    await db.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);
    console.error('Escrow debit failed:', coinErr);
    return err('Could not lock coins in escrow. Please try again.', req, 500);
  }

  return ok({
    success:        true,
    booking_id:     booking.id,
    scheduled_date: booking.scheduled_date,
    start_time:     booking.start_time,
    duration_mins:  booking.duration_mins,
    escrow_amount:  booking.escrow_amount,
    teacher_name:   teacher.name,
    message:        `Session booked! 🪙 ${escrowAmount} coins locked in escrow.`,
  }, req, 201);
}// api/_shared/responses.ts
// Shared HTTP response helpers and CORS configuration.

// ─── CORS ────────────────────────────────────────────────────
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
}

/** Return a 204 for CORS preflight, or null if not OPTIONS. */
export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  return null;
}

// ─── RESPONSE HELPERS ────────────────────────────────────────
/** Success JSON response. */
export function ok(data: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  });
}

/** Error JSON response. */
export function err(message: string, req: Request, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  });
}
// api/_shared/supabase.ts
// Supabase client initialization — Admin (SERVICE_ROLE) and User (ANON + JWT).

import { createClient } from '@supabase/supabase-js';

/**
 * Admin client — bypasses RLS for server-side operations.
 * Uses SERVICE_ROLE key. NEVER expose this key to the client.
 */
/**
 * Environment-agnostic helper to get configuration values.
 * Supports Deno (Supabase Edge Functions) and Node.js (Vercel).
 */
function getEnv(key: string): string | undefined {
  // Access global context safely across Deno and Node.js
  const g = globalThis as any;
  
  try {
    if (g.Deno && g.Deno.env) return g.Deno.env.get(key);
  } catch {}
  
  try {
    if (g.process && g.process.env) return g.process.env[key];
  } catch {}
  
  return undefined;
}


/**
 * Admin client — bypasses RLS for server-side operations.
 * Uses SERVICE_ROLE key. NEVER expose this key to the client.
 */
export function adminClient() {
  const url = getEnv('SUPABASE_URL')!;
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User client — respects RLS by forwarding the user's JWT.
 */
export function userClient(req: Request) {
  const url = getEnv('SUPABASE_URL')!;
  const anonKey = getEnv('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// api/_shared/auth.ts
// Authentication guard — extracts and verifies JWT from the Authorization header.

import { adminClient } from './supabase';



export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Extracts the JWT from the Authorization header and verifies it.
 * Returns the authenticated user or throws AuthError.
 */
export async function requireAuth(req: Request): Promise<{ id: string; email: string }> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) throw new AuthError('Missing authorization token');

  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) throw new AuthError('Invalid or expired token');
  if (!data.user.email) throw new AuthError('User has no email');

  return { id: data.user.id, email: data.user.email };
}
// api/_shared/ledger.ts
// Coin (credit/debit) and XP helpers.
// All operations use SERVICE_ROLE — call only from Edge Functions.

import { adminClient } from './supabase';



/**
 * Credit coins via the append-only ledger.
 */
export async function creditCoins(
  userId: string,
  amount: number,
  type: string,
  refId?: string,
  refType?: string,
  note?: string
): Promise<void> {
  if (amount <= 0) throw new Error('Credit amount must be positive');
  const db = adminClient();
  const { error } = await db.from('coin_ledger').insert({
    user_id: userId,
    amount: +amount.toFixed(1),
    type,
    ref_id: refId ?? null,
    ref_type: refType ?? null,
    note: note ?? null,
  });
  if (error) throw new Error(`Ledger credit failed: ${error.message}`);
}

/**
 * Debit coins via the append-only ledger.
 * Checks balance before deducting — throws if insufficient.
 */
export async function debitCoins(
  userId: string,
  amount: number,
  type: string,
  refId?: string,
  refType?: string,
  note?: string
): Promise<void> {
  if (amount <= 0) throw new Error('Debit amount must be positive');
  const db = adminClient();

  // Guard: check balance first
  const { data } = await db.rpc('get_coin_balance', { p_user_id: userId });
  const balance = Number(data ?? 0);
  if (balance < amount) {
    throw new Error(`Insufficient coins. Balance: ${balance}, Required: ${amount}`);
  }

  const { error } = await db.from('coin_ledger').insert({
    user_id: userId,
    amount: -(+amount.toFixed(1)), // negative = debit
    type,
    ref_id: refId ?? null,
    ref_type: refType ?? null,
    note: note ?? null,
  });
  if (error) throw new Error(`Ledger debit failed: ${error.message}`);
}

/**
 * Award XP and recalculate level via a Postgres RPC.
 */
export async function awardXP(userId: string, xp: number): Promise<void> {
  if (xp <= 0) return;
  const db = adminClient();
  await db.rpc('increment_xp', { p_user_id: userId, p_xp: xp });
}

/**
 * Rate limiter — persists counts to `rate_limit_log` table.
 * Returns true if the limit is exceeded (caller should return 429).
 */
export async function rateLimit(
  key: string,
  action: string,
  maxCount: number,
  windowSeconds: number
): Promise<boolean> {
  const db = adminClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowSeconds * 1000);

  const { count } = await db
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('key', key)
    .eq('action', action)
    .gt('window_end', now.toISOString());

  if ((count ?? 0) >= maxCount) return true; // exceeded

  await db.from('rate_limit_log').insert({
    key,
    action,
    count: 1,
    window_end: windowEnd.toISOString(),
  });

  return false; // within limit
}
// api/_shared/validation.ts
// Input sanitization and validation helpers.

/** Strip basic XSS characters and trim to max length. */
export function sanitizeText(input: unknown, maxLen = 500): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLen).replace(/[<>]/g, '');
}

/** Validate email format. */
export function validateEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** Validate UUID v4 format. */
export function validateUUID(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
