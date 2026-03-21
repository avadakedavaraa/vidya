// supabase/functions/_shared/utils.ts
// Shared helpers used by every Edge Function.
// Import like: import { corsHeaders, requireAuth, rateLimit } from '../_shared/utils.ts'

import { createClient } from '@supabase/supabase-js';

// ─── CORS ────────────────────────────────────────────────────
// Allow all origins (*) so Vercel preview domains and custom domains work natively.
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '*';
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
    'Access-Control-Max-Age':       '86400',
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  return null;
}

// ─── RESPONSE HELPERS ────────────────────────────────────────
export function ok(data: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  });
}

export function err(message: string, req: Request, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  });
}

// ─── SUPABASE ADMIN CLIENT ───────────────────────────────────
// Uses SERVICE_ROLE key — bypasses RLS for server-side operations.
// NEVER expose this key to the client.
export function adminClient() {
  const url  = (() => { try { return process?.env ? process.env : Deno.env } catch { return {} } })().('SUPABASE_URL')!;
  const key  = (() => { try { return process?.env ? process.env : Deno.env } catch { return {} } })().('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── USER CLIENT (respects RLS) ──────────────────────────────
export function userClient(req: Request) {
  const url    = (() => { try { return process?.env ? process.env : Deno.env } catch { return {} } })().('SUPABASE_URL')!;
  const anonKey = (() => { try { return process?.env ? process.env : Deno.env } catch { return {} } })().('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    global:  { headers: { Authorization: authHeader } },
    auth:    { persistSession: false, autoRefreshToken: false },
  });
}

// ─── AUTH GUARD ──────────────────────────────────────────────
// Extracts and verifies the JWT from the Authorization header.
// Returns the authenticated user or throws.
export async function requireAuth(req: Request): Promise<{ id: string; email: string }> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) throw new AuthError('Missing authorization token');

  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) throw new AuthError('Invalid or expired token');
  if (!data.user.email)     throw new AuthError('User has no email');

  return { id: data.user.id, email: data.user.email };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── RATE LIMITER ────────────────────────────────────────────
// Persists counts to `rate_limit_log` table.
// Returns true if limit is exceeded (caller should return 429).
export async function rateLimit(
  key: string,
  action: string,
  maxCount: number,
  windowSeconds: number
): Promise<boolean> {
  const db = adminClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowSeconds * 1000);

  // Count recent requests for this key in the window
  const { count } = await db
    .from('rate_limit_log')
    .select('*', { count: 'exact', head: true })
    .eq('key', key)
    .eq('action', action)
    .gt('window_end', now.toISOString());

  if ((count ?? 0) >= maxCount) return true; // exceeded

  // Log this request
  await db.from('rate_limit_log').insert({
    key,
    action,
    count: 1,
    window_end: windowEnd.toISOString(),
  });

  return false; // within limit
}

// ─── INPUT SANITIZATION ──────────────────────────────────────
export function sanitizeText(input: unknown, maxLen = 500): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLen).replace(/[<>]/g, ''); // strip basic XSS
}

export function validateEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validateUUID(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── COIN HELPERS ────────────────────────────────────────────
// Credit or debit coins via the append-only ledger.
// Must use SERVICE_ROLE (bypasses RLS) — call only from Edge Functions.
export async function creditCoins(
  userId:  string,
  amount:  number,
  type:    string,
  refId?:  string,
  refType?: string,
  note?:   string
): Promise<void> {
  if (amount <= 0) throw new Error('Credit amount must be positive');
  const db = adminClient();
  const { error } = await db.from('coin_ledger').insert({
    user_id:  userId,
    amount:   +amount.toFixed(1),
    type,
    ref_id:   refId   ?? null,
    ref_type: refType ?? null,
    note:     note    ?? null,
  });
  if (error) throw new Error(`Ledger credit failed: ${error.message}`);
}

export async function debitCoins(
  userId:  string,
  amount:  number,
  type:    string,
  refId?:  string,
  refType?: string,
  note?:   string
): Promise<void> {
  if (amount <= 0) throw new Error('Debit amount must be positive');
  // Guard: check balance first
  const db = adminClient();
  const { data } = await db
    .rpc('get_coin_balance', { p_user_id: userId });
  const balance = Number(data ?? 0);
  if (balance < amount) throw new Error(`Insufficient coins. Balance: ${balance}, Required: ${amount}`);

  const { error } = await db.from('coin_ledger').insert({
    user_id:  userId,
    amount:   -(+amount.toFixed(1)),   // negative = debit
    type,
    ref_id:   refId   ?? null,
    ref_type: refType ?? null,
    note:     note    ?? null,
  });
  if (error) throw new Error(`Ledger debit failed: ${error.message}`);
}

// ─── XP + LEVEL ──────────────────────────────────────────────
export async function awardXP(userId: string, xp: number): Promise<void> {
  if (xp <= 0) return;
  const db = adminClient();
  // Increment XP and recalculate level (L = floor(sqrt(total_xp / 100)) + 1, capped at 50)
  await db.rpc('increment_xp', { p_user_id: userId, p_xp: xp });
}
