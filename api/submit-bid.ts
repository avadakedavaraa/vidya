// supabase/functions/submit-bid/index.ts
// Submits a blind (encrypted) bid on a bounty.
// Validates: bounty is open, not already bid, bidder has 1-coin deposit, proposal is encrypted.

import {
  handleOptions, ok, err,
  adminClient, requireAuth,
  rateLimit, debitCoins,
  sanitizeText, validateUUID, AuthError
} from './_shared/utils';

const DEPOSIT_AMOUNT = 1; // 1 coin deposit per bid

export const config = { runtime: 'edge' };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401);
  }

  // ─── Rate limit: 20 bids per user per day ──────────────
  const limited = await rateLimit(`bid:${user.id}`, 'submit_bid', 20, 86400);
  if (limited) return err('Too many bids today. Please wait.', req, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  const bountyId           = body.bounty_id as string;
  const encryptedProposal  = body.encrypted_proposal as string;  // AES-256-GCM base64 ciphertext
  const encryptionIv       = body.encryption_iv as string;       // base64 IV
  const coinQuote          = Number(body.coin_quote);
  const deliveryDays       = Number(body.delivery_days);
  const portfolioUrl       = (body.portfolio_url as string ?? '').trim();

  // ─── Validation ────────────────────────────────────────
  if (!validateUUID(bountyId))            return err('Invalid bounty ID', req, 400);
  if (!encryptedProposal || encryptedProposal.length < 20) {
    return err('Encrypted proposal is required', req, 400);
  }
  if (!encryptionIv)                      return err('Encryption IV is required', req, 400);
  if (coinQuote < 0.5)                    return err('Minimum quote is 0.5 coins', req, 400);
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 90) {
    return err('Delivery days must be 1–90', req, 400);
  }
  if (portfolioUrl && !/^https?:\/\//.test(portfolioUrl)) {
    return err('Portfolio URL must start with http:// or https://', req, 400);
  }

  const db = adminClient();

  // ─── Check bounty exists and is open ───────────────────
  const { data: bounty, error: bountyErr } = await db
    .from('bounties')
    .select('id, poster_id, status, deadline_at, title, coin_reward')
    .eq('id', bountyId)
    .single();

  if (bountyErr || !bounty) return err('Bounty not found', req, 404);
  if (bounty.status !== 'open') return err('This bounty is no longer accepting bids', req, 400);
  if (bounty.poster_id === user.id) return err('You cannot bid on your own bounty', req, 400);

  const deadline = new Date(bounty.deadline_at);
  if (deadline <= new Date()) return err('This bounty has expired', req, 400);

  // ─── Check not already bid ─────────────────────────────
  const { count: existingBid } = await db
    .from('bounty_bids')
    .select('*', { count: 'exact', head: true })
    .eq('bounty_id', bountyId)
    .eq('bidder_id', user.id);

  if ((existingBid ?? 0) > 0) {
    return err('You have already submitted a bid for this bounty', req, 409);
  }

  // ─── Check bidder has enough coins for deposit ─────────
  const { data: balanceData } = await db
    .rpc('get_coin_balance', { p_user_id: user.id });
  const balance = Number(balanceData ?? 0);
  if (balance < DEPOSIT_AMOUNT) {
    return err(`You need at least ${DEPOSIT_AMOUNT} coin to bid (deposit). Your balance: ${balance}`, req, 400);
  }

  // ─── Insert bid ────────────────────────────────────────
  const { data: bid, error: bidErr } = await db
    .from('bounty_bids')
    .insert({
      bounty_id:           bountyId,
      bidder_id:           user.id,
      encrypted_proposal:  encryptedProposal,
      encryption_iv:       encryptionIv,
      coin_quote:          coinQuote,
      delivery_days:       deliveryDays,
      portfolio_url:       portfolioUrl || null,
      deposit_amount:      DEPOSIT_AMOUNT,
      status:              'pending',
    })
    .select('id')
    .single();

  if (bidErr || !bid) {
    // If unique constraint violated (race condition), return friendly message
    if (bidErr?.code === '23505') {
      return err('You have already submitted a bid for this bounty', req, 409);
    }
    console.error('Bid insert failed:', bidErr);
    return err('Failed to submit bid. Please try again.', req, 500);
  }

  // ─── Lock deposit ──────────────────────────────────────
  try {
    await debitCoins(
      user.id,
      DEPOSIT_AMOUNT,
      'bounty_deposit',
      bid.id,
      'bounty',
      `Bid deposit for: ${bounty.title.slice(0, 50)}`
    );
  } catch (coinErr) {
    // Rollback: delete the bid
    await db.from('bounty_bids').delete().eq('id', bid.id);
    return err('Could not lock bid deposit. Please try again.', req, 500);
  }

  // ─── Increment bid count on bounty ─────────────────────
  await db.rpc('increment_bid_count', { p_bounty_id: bountyId }); // SQL function below
  // Fallback if RPC not available:
  // await db.from('bounties').update({ bid_count: bounty.bid_count + 1 }).eq('id', bountyId);

  return ok({
    success:   true,
    bid_id:    bid.id,
    deposit:   DEPOSIT_AMOUNT,
    message:   `Encrypted bid submitted! 🔒 ${DEPOSIT_AMOUNT} coin deposit held.`,
  }, req, 201);
}