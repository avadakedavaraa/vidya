// api/release-escrow.ts
// Cron job: finds stale sessions, auto-resolves disputes, closes expired bounties.
// Uses SERVICE_ROLE — no user auth required.

import { adminClient } from "./_shared/supabase";

const HEARTBEAT_TIMEOUT_MINS = 15;
const DISPUTE_AUTO_RESOLVE_DAYS = 14;

export const config = { runtime: "edge" };

export default async function (req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = process.env["CRON_SECRET"] ?? "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const db = adminClient();
  const now = new Date();
  const results: Record<string, number> = {
    stale_sessions_processed: 0,
    disputes_auto_resolved: 0,
    expired_bounties_closed: 0,
  };

  // ─── 1. Stale active sessions ──────────────────────────
  const staleThreshold = new Date(
    now.getTime() - HEARTBEAT_TIMEOUT_MINS * 60 * 1000,
  );
  const { data: staleSessions } = await db
    .from("bookings")
    .select(
      "id, learner_id, teacher_id, escrow_amount, duration_mins, actual_start_at, heartbeat_at",
    )
    .eq("status", "active")
    .lt("heartbeat_at", staleThreshold.toISOString());

  for (const session of staleSessions ?? []) {
    try {
      const startAt = new Date(session.actual_start_at ?? session.heartbeat_at);
      const elapsedSec = Math.floor((now.getTime() - startAt.getTime()) / 1000);
      const { data: prorata } = await db.rpc("calc_prorata_release", {
        p_booking_id: session.id,
        p_elapsed_seconds: elapsedSec,
      });
      const releaseAmount = Number(prorata ?? 0);
      const escrow = Number(session.escrow_amount);
      const refundAmount = +(escrow - releaseAmount).toFixed(1);

      await db
        .from("bookings")
        .update({
          status: "partial_refund",
          actual_end_at: now.toISOString(),
          actual_mins: Math.floor(elapsedSec / 60),
          released_amount: releaseAmount,
        })
        .eq("id", session.id);
      if (releaseAmount > 0)
        await db
          .from("coin_ledger")
          .insert({
            user_id: session.teacher_id,
            amount: +releaseAmount.toFixed(1),
            type: "escrow_prorata",
            ref_id: session.id,
            ref_type: "booking",
            note: "Auto pro-rata: session heartbeat timeout",
          });
      if (refundAmount > 0)
        await db
          .from("coin_ledger")
          .insert({
            user_id: session.learner_id,
            amount: +refundAmount.toFixed(1),
            type: "escrow_prorata",
            ref_id: session.id,
            ref_type: "booking",
            note: "Auto refund: session heartbeat timeout",
          });
      results.stale_sessions_processed++;
    } catch (e) {
      console.error(`Failed to process stale session ${session.id}:`, e);
    }
  }

  // ─── 2. Auto-resolve old disputes ──────────────────────
  const disputeThreshold = new Date(
    now.getTime() - DISPUTE_AUTO_RESOLVE_DAYS * 86400 * 1000,
  );
  const { data: oldDisputes } = await db
    .from("disputes")
    .select("id, filed_by, against, ref_id, ref_type")
    .eq("status", "open")
    .lt("created_at", disputeThreshold.toISOString());
  for (const dispute of oldDisputes ?? []) {
    try {
      await db
        .from("disputes")
        .update({
          status: "split",
          resolution: "Auto-resolved after 14 days: 50/50 coin split applied.",
          resolved_at: now.toISOString(),
        })
        .eq("id", dispute.id);
      if (dispute.ref_type === "booking") {
        const { data: booking } = await db
          .from("bookings")
          .select("learner_id, teacher_id, escrow_amount")
          .eq("id", dispute.ref_id)
          .single();
        if (booking) {
          const half = +(Number(booking.escrow_amount) / 2).toFixed(1);
          if (half > 0)
            await db.from("coin_ledger").insert([
              {
                user_id: booking.teacher_id,
                amount: half,
                type: "escrow_release",
                ref_id: dispute.ref_id,
                ref_type: "booking",
                note: "Dispute auto-resolved: 50/50 split",
              },
              {
                user_id: booking.learner_id,
                amount: half,
                type: "escrow_refund",
                ref_id: dispute.ref_id,
                ref_type: "booking",
                note: "Dispute auto-resolved: 50/50 split",
              },
            ]);
        }
      }
      results.disputes_auto_resolved++;
    } catch (e) {
      console.error(`Failed to auto-resolve dispute ${dispute.id}:`, e);
    }
  }

  // ─── 3. Close expired bounties ─────────────────────────
  const { data: expiredBounties } = await db
    .from("bounties")
    .select("id, poster_id, coin_reward")
    .eq("status", "open")
    .lt("deadline_at", now.toISOString());
  for (const bounty of expiredBounties ?? []) {
    try {
      await db
        .from("bounties")
        .update({ status: "cancelled" })
        .eq("id", bounty.id);
      const { count: selectedBids } = await db
        .from("bounty_bids")
        .select("*", { count: "exact", head: true })
        .eq("bounty_id", bounty.id)
        .eq("status", "selected");
      if ((selectedBids ?? 0) === 0)
        await db
          .from("coin_ledger")
          .insert({
            user_id: bounty.poster_id,
            amount: +Number(bounty.coin_reward).toFixed(1),
            type: "escrow_refund",
            ref_id: bounty.id,
            ref_type: "bounty",
            note: "Bounty expired with no winner — full refund",
          });
      const { data: pendingBids } = await db
        .from("bounty_bids")
        .select("id, bidder_id, deposit_amount")
        .eq("bounty_id", bounty.id)
        .eq("status", "pending");
      for (const bid of pendingBids ?? []) {
        await db
          .from("coin_ledger")
          .insert({
            user_id: bid.bidder_id,
            amount: +Number(bid.deposit_amount).toFixed(1),
            type: "bounty_deposit_returned",
            ref_id: bid.id,
            ref_type: "bounty",
            note: "Bid deposit returned: bounty expired",
          });
        await db
          .from("bounty_bids")
          .update({ status: "deposit_returned" })
          .eq("id", bid.id);
      }
      results.expired_bounties_closed++;
    } catch (e) {
      console.error(`Failed to close expired bounty ${bounty.id}:`, e);
    }
  }

  // ─── 4. Cleanup expired OTPs ──────────────────────────
  await db.rpc("cleanup_expired_otps");

  console.log("Cron job results:", results);
  return new Response(JSON.stringify({ success: true, ...results }), {
    headers: { "Content-Type": "application/json" },
  });
}
