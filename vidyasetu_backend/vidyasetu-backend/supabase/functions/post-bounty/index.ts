// supabase/functions/post-bounty/index.ts
// Creates a bounty and locks the coin reward in escrow.
// Security: validates poster has enough coins, deadline is future, reward >= 1.

import {
  handleOptions, ok, err,
  adminClient, requireAuth,
  rateLimit, debitCoins,
  sanitizeText, validateUUID, AuthError
} from '../_shared/utils.ts';

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401);
  }

  // ─── Rate limit: 5 bounties per user per hour ──────────
  const limited = await rateLimit(`bounty:${user.id}`, 'post_bounty', 5, 3600);
  if (limited) return err('Too many bounty posts. Please wait.', req, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  const title       = sanitizeText(body.title       as string ?? '', 120);
  const description = sanitizeText(body.description as string ?? '', 2000);
  const category    = body.category as string;
  const tags        = Array.isArray(body.tags)
    ? (body.tags as string[]).map(t => sanitizeText(t, 40)).slice(0, 5)
    : [];
  const coinReward  = Number(body.coin_reward);
  const deadlineAt  = body.deadline_at as string;

  // ─── Validation ────────────────────────────────────────
  if (!title || title.length < 5)       return err('Title must be at least 5 characters', req, 400);
  if (!description || description.length < 20) return err('Description too short (min 20 chars)', req, 400);
  const validCategories = ['design','programming','content','data','marketing','language','music','other'];
  if (!validCategories.includes(category)) return err('Invalid category', req, 400);
  if (coinReward < 1)                   return err('Minimum reward is 1 coin', req, 400);
  if (!deadlineAt)                      return err('Deadline is required', req, 400);

  const deadline = new Date(deadlineAt);
  if (isNaN(deadline.getTime()) || deadline <= new Date()) {
    return err('Deadline must be a future date', req, 400);
  }

  const db = adminClient();

  // ─── Check balance ─────────────────────────────────────
  const { data: balanceData } = await db
    .rpc('get_coin_balance', { p_user_id: user.id });
  const balance = Number(balanceData ?? 0);
  if (balance < coinReward) {
    return err(`Insufficient coins. You have ${balance}, need ${coinReward}.`, req, 400);
  }

  // ─── Insert bounty ─────────────────────────────────────
  const { data: bounty, error: bountyErr } = await db
    .from('bounties')
    .insert({
      poster_id:   user.id,
      title,
      description,
      category,
      tags,
      coin_reward: coinReward,
      deadline_at: deadline.toISOString(),
      status:      'open',
    })
    .select('id, title, coin_reward')
    .single();

  if (bountyErr || !bounty) {
    console.error('Bounty insert failed:', bountyErr);
    return err('Failed to create bounty. Try again.', req, 500);
  }

  // ─── Lock coins in escrow ──────────────────────────────
  try {
    await debitCoins(
      user.id,
      coinReward,
      'bounty_posted',
      bounty.id,
      'bounty',
      `Escrow for bounty: ${title.slice(0, 50)}`
    );
  } catch (coinErr) {
    await db.from('bounties').update({ status: 'cancelled' }).eq('id', bounty.id);
    return err('Could not lock coins. Please try again.', req, 500);
  }

  return ok({
    success:     true,
    bounty_id:   bounty.id,
    title:       bounty.title,
    coin_reward: bounty.coin_reward,
    message:     `Bounty posted! 🪙 ${coinReward} coins locked in escrow.`,
  }, req, 201);
});
