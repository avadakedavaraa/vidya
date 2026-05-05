// api/_shared/ledger.ts
// Coin (credit/debit) and XP helpers.
// All operations use SERVICE_ROLE — call only from Edge Functions.

import { adminClient } from './supabase.ts';


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
