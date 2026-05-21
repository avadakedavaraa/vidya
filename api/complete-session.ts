// api/complete-session.ts
// Called when a session ends (user clicks "End Session" in 07_session.html).
// Handles: full release, pro-rata release (disconnect), or refund (15-min trial).
// Awards XP to both participants. Updates streak. Triggers quest progress.

import { handleOptions, ok, err } from "./_shared/responses";
import { adminClient } from "./_shared/supabase";
import { requireAuth, AuthError } from "./_shared/auth";
import { creditCoins, awardXP } from "./_shared/ledger";
import { validateUUID } from "./_shared/validation";

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", req, 400);
  }

  const bookingId = body.booking_id as string;
  const elapsedSecs = Number(body.elapsed_seconds ?? 0);
  const rating = Number(body.rating ?? 0);
  const review = ((body.review as string) ?? "").slice(0, 400);
  const reason = (body.reason as string) ?? "completed"; // 'completed' | 'disconnect' | 'trial_refund'

  if (!validateUUID(bookingId)) return err("Invalid booking ID", req, 400);
  if (elapsedSecs < 0)
    return err("Elapsed seconds cannot be negative", req, 400);
  if (rating && (rating < 1 || rating > 5))
    return err("Rating must be 1–5", req, 400);

  const db = adminClient();

  // ─── Load booking ─────────────────────────────────────
  const { data: booking, error: bookingErr } = await db
    .from("bookings")
    .select(
      "id, learner_id, teacher_id, escrow_amount, duration_mins, status, coin_rate, skill_name",
    )
    .eq("id", bookingId)
    .single();

  if (bookingErr || !booking) return err("Booking not found", req, 404);

  // ─── Auth: must be learner or teacher ─────────────────
  if (booking.learner_id !== user.id && booking.teacher_id !== user.id) {
    return err("You are not a participant in this session", req, 403);
  }

  // ─── State check ──────────────────────────────────────
  const joinableStatuses = ["pending", "confirmed", "active", "scheduled", "soon", "tomorrow"];
  if (!joinableStatuses.includes(booking.status)) {
    return err(
      `Cannot complete session with status: ${booking.status}`,
      req,
      400,
    );
  }

  // ─── Auto-activate if still pending/confirmed ──────────
  // Mark as active so heartbeat and other logic works correctly
  if (["pending", "confirmed", "scheduled", "soon", "tomorrow"].includes(booking.status)) {
    await db
      .from("bookings")
      .update({ status: "active", actual_start_at: new Date(Date.now() - elapsedSecs * 1000).toISOString() })
      .eq("id", bookingId);
  }

  const escrow = Number(booking.escrow_amount);
  let releaseAmount = 0;
  let refundAmount = 0;
  let newStatus = "completed";

  // ─── Calculate release amount ─────────────────────────
  if (reason === "trial_refund") {
    if (elapsedSecs > 900) {
      return err(
        "15-minute trial window has passed. Cannot issue full refund.",
        req,
        400,
      );
    }
    refundAmount = escrow;
    releaseAmount = 0;
    newStatus = "refunded";
  } else if (reason === "disconnect") {
    const { data: prorata } = await db.rpc("calc_prorata_release", {
      p_booking_id: bookingId,
      p_elapsed_seconds: elapsedSecs,
    });
    releaseAmount = Number(prorata ?? 0);
    refundAmount = +(escrow - releaseAmount).toFixed(1);
    newStatus = "partial_refund";
  } else {
    releaseAmount = escrow;
    refundAmount = 0;
    newStatus = "completed";
  }

  // ─── Update booking record ────────────────────────────
  const updateData: Record<string, unknown> = {
    status: newStatus,
    actual_end_at: new Date().toISOString(),
    actual_mins: Math.floor(elapsedSecs / 60),
    released_amount: releaseAmount,
  };
  if (reason === "completed" && !(booking as any).actual_start_at) {
    updateData.actual_start_at = new Date(
      Date.now() - elapsedSecs * 1000,
    ).toISOString();
  }
  if (rating && booking.learner_id === user.id) {
    updateData.learner_rating = rating;
    updateData.learner_review = review || null;
    updateData.reviewed_at = new Date().toISOString();
  }

  const { error: updateErr } = await db
    .from("bookings")
    .update(updateData)
    .eq("id", bookingId);

  if (updateErr) {
    console.error("Booking update failed:", updateErr);
    return err("Failed to complete session. Please contact support.", req, 500);
  }

  // ─── Ledger: release coins to teacher ────────────────
  if (releaseAmount > 0) {
    await creditCoins(
      booking.teacher_id,
      releaseAmount,
      reason === "disconnect" ? "escrow_prorata" : "escrow_release",
      bookingId,
      "booking",
      `${reason === "disconnect" ? "Pro-rata" : "Full"} release for session`,
    );
  }

  // ─── Ledger: refund remaining coins to learner ────────
  if (refundAmount > 0) {
    await creditCoins(
      booking.learner_id,
      refundAmount,
      reason === "trial_refund" ? "escrow_refund" : "escrow_prorata",
      bookingId,
      "booking",
      reason === "trial_refund"
        ? "15-min trial refund"
        : "Pro-rata refund (disconnect)",
    );
  }

  // ─── Award XP (only for full/partial completions) ────
  if (newStatus !== "refunded") {
    const teacherXP = 100;
    const learnerXP = 50;
    await Promise.all([
      awardXP(booking.teacher_id, teacherXP),
      awardXP(booking.learner_id, learnerXP),
    ]);
  }

  // ─── Update quest progress for teacher ───────────────
  if (newStatus === "completed") {
    await incrementQuestProgress(db, booking.teacher_id, "sessions_taught");
    await incrementQuestProgress(db, booking.learner_id, "sessions_booked");
  }

  // ─── Update streak ────────────────────────────────────
  await db
    .from("users")
    .update({ last_active_at: new Date().toISOString() })
    .in("id", [booking.learner_id, booking.teacher_id]);

  return ok(
    {
      success: true,
      status: newStatus,
      released_coins: releaseAmount,
      refunded_coins: refundAmount,
      reason,
      message:
        newStatus === "refunded"
          ? `Full refund issued. 🪙 ${refundAmount} coins returned.`
          : newStatus === "partial_refund"
            ? `Session ended early. 🪙 ${releaseAmount} released, 🪙 ${refundAmount} refunded.`
            : `Session complete! 🪙 ${releaseAmount} coins released to teacher.`,
    },
    req,
  );
}

// ─── Increment quest progress helper ──────────────────────────
async function incrementQuestProgress(
  db: ReturnType<typeof adminClient>,
  userId: string,
  criteria: string,
): Promise<void> {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { data: quests } = await db
      .from("quests")
      .select("id, target, type, xp_reward, coin_reward")
      .eq("criteria", criteria)
      .eq("is_active", true);

    if (!quests?.length) return;

    for (const quest of quests) {
      const periodStart =
        quest.type === "weekly"
          ? getWeekStart().toISOString()
          : today.toISOString();

      const { data: existing } = await db
        .from("user_quest_progress")
        .select("id, progress, completed, claimed")
        .eq("user_id", userId)
        .eq("quest_id", quest.id)
        .eq("period_start", periodStart)
        .maybeSingle();

      if (existing?.completed) continue;

      const newProgress = (existing?.progress ?? 0) + 1;
      const isNowDone = newProgress >= quest.target;

      if (existing) {
        await db
          .from("user_quest_progress")
          .update({
            progress: newProgress,
            completed: isNowDone,
            completed_at: isNowDone ? new Date().toISOString() : null,
          })
          .eq("id", existing.id);
      } else {
        await db.from("user_quest_progress").insert({
          user_id: userId,
          quest_id: quest.id,
          progress: newProgress,
          completed: isNowDone,
          period_start: periodStart,
          completed_at: isNowDone ? new Date().toISOString() : null,
        });
      }
    }
  } catch (e) {
    console.error("Quest progress update failed:", e);
  }
}

function getWeekStart(): Date {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
