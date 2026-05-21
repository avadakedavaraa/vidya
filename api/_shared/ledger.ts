import { adminClient } from "./supabase";

function toLedgerAmount(amount: number): number {
  return +amount.toFixed(1);
}

export async function creditCoins(
  userId: string,
  amount: number,
  type: string,
  refId?: string,
  refType?: string,
  note?: string,
): Promise<void> {
  if (amount <= 0) {
    throw new Error("Credit amount must be positive");
  }

  const db = adminClient();
  const { error } = await db.from("coin_ledger").insert({
    amount: toLedgerAmount(amount),
    note: note ?? null,
    ref_id: refId ?? null,
    ref_type: refType ?? null,
    type,
    user_id: userId,
  });

  if (error) {
    throw new Error(`Ledger credit failed: ${error.message}`);
  }
}

export async function debitCoins(
  userId: string,
  amount: number,
  type: string,
  refId?: string,
  refType?: string,
  note?: string,
): Promise<void> {
  if (amount <= 0) {
    throw new Error("Debit amount must be positive");
  }

  const db = adminClient();
  const { data } = await db.rpc("get_coin_balance", { p_user_id: userId });
  const balance = Number(data ?? 0);

  if (balance < amount) {
    throw new Error(
      `Insufficient coins. Balance: ${balance}, Required: ${amount}`,
    );
  }

  const { error } = await db.from("coin_ledger").insert({
    amount: -toLedgerAmount(amount),
    note: note ?? null,
    ref_id: refId ?? null,
    ref_type: refType ?? null,
    type,
    user_id: userId,
  });

  if (error) {
    throw new Error(`Ledger debit failed: ${error.message}`);
  }
}

export async function awardXP(userId: string, xp: number): Promise<void> {
  if (xp <= 0) {
    return;
  }

  const db = adminClient();
  await db.rpc("increment_xp", { p_user_id: userId, p_xp: xp });
}

export async function rateLimit(
  key: string,
  action: string,
  maxCount: number,
  windowSeconds: number,
): Promise<boolean> {
  const db = adminClient();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowSeconds * 1000);

  const { count } = await db
    .from("rate_limit_log")
    .select("*", { count: "exact", head: true })
    .eq("key", key)
    .eq("action", action)
    .gt("window_end", now.toISOString());

  if ((count ?? 0) >= maxCount) {
    return true;
  }

  await db.from("rate_limit_log").insert({
    action,
    count: 1,
    key,
    window_end: windowEnd.toISOString(),
  });

  return false;
}
