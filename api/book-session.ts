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

  // Auth
  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401);
  }

  // Rate limit: 10 bookings per user per hour.
  const limited = await rateLimit(`book:${user.id}`, 'book_session', 10, 3600);
  if (limited) return err('Too many booking attempts. Please wait.', req, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  // Validate inputs.
  const teacherId = body.teacher_id as string;
  const skillName = sanitizeText(body.skill_name as string ?? '', 80);
  const topic = sanitizeText(body.topic as string ?? '', 100);
  const note = sanitizeText(body.note as string ?? '', 500);
  const scheduledDate = body.scheduled_date as string;
  const startTime = body.start_time as string;
  const durationMins = Number(body.duration_mins);
  const coinRate = Number(body.coin_rate);

  if (!validateUUID(teacherId)) return err('Invalid teacher ID', req, 400);
  if (teacherId === user.id) return err('You cannot book yourself', req, 400);
  if (!skillName) return err('Skill name is required', req, 400);
  if (!scheduledDate || !startTime) return err('Date and time are required', req, 400);
  if (![60, 90, 120, 180].includes(durationMins)) {
    return err('Duration must be 60, 90, 120, or 180 minutes', req, 400);
  }
  if (coinRate <= 0 || coinRate > 10) return err('Invalid coin rate', req, 400);

  // Calculate escrow.
  const escrowAmount = +(coinRate * (durationMins / 60)).toFixed(1);
  if (escrowAmount <= 0) return err('Escrow amount must be positive', req, 400);

  // Date validation.
  const bookingDateTime = new Date(`${scheduledDate}T${startTime}:00`);
  if (bookingDateTime <= new Date()) {
    return err('Booking must be in the future', req, 400);
  }

  const db = adminClient();

  // Check teacher exists and is not banned.
  const { data: teacher, error: teacherErr } = await db
    .from('users')
    .select('id, name, is_banned')
    .eq('id', teacherId)
    .single();

  if (teacherErr || !teacher) return err('Teacher not found', req, 404);
  if (teacher.is_banned) return err('This teacher account is currently unavailable', req, 400);

  // Check learner has enough coins.
  const { data: balanceData } = await db
    .rpc('get_coin_balance', { p_user_id: user.id });
  const balance = Number(balanceData ?? 0);

  if (balance < escrowAmount) {
    return err(
      `Insufficient coins. You have ${balance} coins but need ${escrowAmount}.`,
      req,
      400
    );
  }

  // Check no conflicting bookings for teacher.
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

  // Create booking.
  const { data: booking, error: bookingErr } = await db
    .from('bookings')
    .insert({
      learner_id: user.id,
      teacher_id: teacherId,
      skill_name: skillName,
      topic: topic || null,
      note_from_learner: note || null,
      scheduled_date: scheduledDate,
      start_time: startTime,
      duration_mins: durationMins,
      coin_rate: coinRate,
      escrow_amount: escrowAmount,
      status: 'confirmed',
    })
    .select('id, scheduled_date, start_time, duration_mins, escrow_amount')
    .single();

  if (bookingErr || !booking) {
    console.error('Booking insert failed:', bookingErr);
    return err('Booking failed. Please try again.', req, 500);
  }

  // Lock coins in escrow (atomic ledger debit).
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
    await db.from('bookings').update({ status: 'cancelled' }).eq('id', booking.id);
    console.error('Escrow debit failed:', coinErr);
    return err('Could not lock coins in escrow. Please try again.', req, 500);
  }

  return ok({
    success: true,
    booking_id: booking.id,
    scheduled_date: booking.scheduled_date,
    start_time: booking.start_time,
    duration_mins: booking.duration_mins,
    escrow_amount: booking.escrow_amount,
    teacher_name: teacher.name,
    message: `Session booked! 🪙 ${escrowAmount} coins locked in escrow.`,
  }, req, 201);
}
