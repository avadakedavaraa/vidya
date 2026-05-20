// api/submit-bid.ts
// Submits a blind (encrypted) bid on a bounty.

import { handleOptions, ok, err } from "./_shared/responses";
import { adminClient } from "./_shared/supabase";
import { requireAuth, AuthError } from "./_shared/auth";
import { rateLimit, debitCoins } from "./_shared/ledger";
import { validateUUID } from "./_shared/validation";

const DEPOSIT_AMOUNT = 1;
export const config = { runtime: "edge" };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return err("Method not allowed", req, 405);

  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : "Unauthorized", req, 401);
  }

  const limited = await rateLimit(`bid:${user.id}`, "submit_bid", 20, 86400);
  if (limited) return err("Too many bids today. Please wait.", req, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", req, 400);
  }

  const bountyId = body.bounty_id as string;
  const encryptedProposal = body.encrypted_proposal as string;
  const encryptionIv = body.encryption_iv as string;
  const coinQuote = Number(body.coin_quote);
  const deliveryDays = Number(body.delivery_days);
  const portfolioUrl = ((body.portfolio_url as string) ?? "").trim();

  if (!validateUUID(bountyId)) return err("Invalid bounty ID", req, 400);
  if (!encryptedProposal || encryptedProposal.length < 20)
    return err("Encrypted proposal is required", req, 400);
  if (!encryptionIv) return err("Encryption IV is required", req, 400);
  if (coinQuote < 0.5) return err("Minimum quote is 0.5 coins", req, 400);
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 90)
    return err("Delivery days must be 1–90", req, 400);
  if (portfolioUrl && !/^https?:\/\//.test(portfolioUrl))
    return err("Portfolio URL must start with http:// or https://", req, 400);

  const db = adminClient();
  const { data: bounty, error: bountyErr } = await db
    .from("bounties")
    .select("id, poster_id, status, deadline_at, title, coin_reward")
    .eq("id", bountyId)
    .single();
  if (bountyErr || !bounty) return err("Bounty not found", req, 404);
  if (bounty.status !== "open")
    return err("This bounty is no longer accepting bids", req, 400);
  if (bounty.poster_id === user.id)
    return err("You cannot bid on your own bounty", req, 400);
  if (new Date(bounty.deadline_at) <= new Date())
    return err("This bounty has expired", req, 400);

  const { count: existingBid } = await db
    .from("bounty_bids")
    .select("*", { count: "exact", head: true })
    .eq("bounty_id", bountyId)
    .eq("bidder_id", user.id);
  if ((existingBid ?? 0) > 0)
    return err("You have already submitted a bid for this bounty", req, 409);

  const { data: balanceData } = await db.rpc("get_coin_balance", {
    p_user_id: user.id,
  });
  if (Number(balanceData ?? 0) < DEPOSIT_AMOUNT)
    return err(
      `You need at least ${DEPOSIT_AMOUNT} coin to bid (deposit). Your balance: ${balanceData}`,
      req,
      400,
    );

  const { data: bid, error: bidErr } = await db
    .from("bounty_bids")
    .insert({
      bounty_id: bountyId,
      bidder_id: user.id,
      encrypted_proposal: encryptedProposal,
      encryption_iv: encryptionIv,
      coin_quote: coinQuote,
      delivery_days: deliveryDays,
      portfolio_url: portfolioUrl || null,
      deposit_amount: DEPOSIT_AMOUNT,
      status: "pending",
    })
    .select("id")
    .single();

  if (bidErr || !bid) {
    if (bidErr?.code === "23505")
      return err("You have already submitted a bid for this bounty", req, 409);
    return err("Failed to submit bid. Please try again.", req, 500);
  }

  try {
    await debitCoins(
      user.id,
      DEPOSIT_AMOUNT,
      "bounty_deposit",
      bid.id,
      "bounty",
      `Bid deposit for: ${bounty.title.slice(0, 50)}`,
    );
  } catch {
    await db.from("bounty_bids").delete().eq("id", bid.id);
    return err("Could not lock bid deposit. Please try again.", req, 500);
  }

  await db.rpc("increment_bid_count", { p_bounty_id: bountyId });
  return ok(
    {
      success: true,
      bid_id: bid.id,
      deposit: DEPOSIT_AMOUNT,
      message: `Encrypted bid submitted! 🔒 ${DEPOSIT_AMOUNT} coin deposit held.`,
    },
    req,
    201,
  );
}
