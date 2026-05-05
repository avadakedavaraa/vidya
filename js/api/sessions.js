/**
 * js/api/sessions.js — Booking and session management.
 */
import { getSupabase, edgeFn, APIError } from './client.js';

export const sessions = {
  async book(payload) { return edgeFn('book-session-v4', payload); },



  async heartbeat(bookingId) {
    const sb = getSupabase();
    await sb.from('bookings').update({ heartbeat_at: new Date().toISOString() }).eq('id', bookingId);
  },

  async complete(bookingId, elapsedSeconds, { rating, review, reason = 'completed' } = {}) {
    return edgeFn('complete-session', { booking_id: bookingId, elapsed_seconds: elapsedSeconds, rating: rating ?? null, review: review ?? null, reason });
  },

  async list(status = null) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { upcoming: [], completed: [] };
    let query = supabase.from('bookings').select(`id, skill_name, topic, scheduled_date, start_time, duration_mins, coin_rate, escrow_amount, status, actual_start_at, actual_end_at, learner_rating, reviewed_at, learner:learner_id(id, name, avatar_color), teacher:teacher_id(id, name, avatar_color)`).or(`learner_id.eq.${user.id},teacher_id.eq.${user.id}`).order('scheduled_date', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new APIError(error.message, 500);
    const processedData = data ?? [];
    const upcoming = processedData.filter(b => ['pending', 'confirmed', 'active', 'soon', 'scheduled', 'tomorrow'].includes(b.status));
    const completed = processedData.filter(b => ['completed'].includes(b.status));
    const cancelled = processedData.filter(b => ['cancelled', 'refunded', 'partial_refund'].includes(b.status));
    return { upcoming, completed, cancelled };
  },

  async getAll() {
    const res = await this.list();
    const userId = localStorage.getItem('vs_user_id');
    const mapper = b => ({
      id: b.id,
      role: b.teacher?.id === userId ? 'teaching' : 'learning',
      teacherId: b.teacher?.id,
      name: b.teacher?.id === userId ? (b.learner?.name || 'Learner') : (b.teacher?.name || 'Teacher'),
      initials: (b.teacher?.id === userId ? (b.learner?.name || 'L') : (b.teacher?.name || 'T')).split(' ').map(n => n[0]).join('').substring(0, 2),
      color: b.teacher?.id === userId ? (b.learner?.avatar_color || '#16A27B') : (b.teacher?.avatar_color || '#5B45E0'),
      skill: b.skill_name, duration: (b.duration_mins / 60) + 'h', date: b.scheduled_date + ' · ' + b.start_time,
      coins: b.escrow_amount, status: b.status, statusLabel: b.status, canJoin: b.status === 'confirmed' || b.status === 'active',
      rating: b.learner_rating || 5, reviewed: !!b.reviewed_at
    });
    return {
      upcoming: res.upcoming.map(mapper),
      completed: res.completed.map(mapper),
      cancelled: res.cancelled.map(mapper)
    };
  },

  async confirm(bookingId) {
    const sb = getSupabase();
    const { error } = await sb.from('bookings').update({ status: 'confirmed' }).eq('id', bookingId);
    if (error) throw new APIError(error.message, 500);
    return true;
  },

  async cancel(bookingId) {
    const sb = getSupabase();
    const { error } = await sb.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
    if (error) throw new APIError(error.message, 500);
    return true;
  },

  async update(bookingId, updates) {
    const sb = getSupabase();
    const { error } = await sb.from('bookings').update(updates).eq('id', bookingId);
    if (error) throw new APIError(error.message, 500);
    return true;
  }
};
