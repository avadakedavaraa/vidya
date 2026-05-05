/**
 * js/api/matchmaking.js — Skill matchmaking and secure match booking.
 */
import { getSupabase, APIError } from './client.js';

export const matchmaking = {
  async findMatch(type, skillStr) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const mySkill = { user_id: user.id, name: skillStr, category: 'other', is_learning: type === 'learn', is_teaching: type === 'teach', tier: 'unverified' };
    await supabase.from('skills').insert(mySkill);
    let query = supabase.from('skills').select(`id, name, is_learning, is_teaching, users!inner(id, name, avatar_color)`).ilike('name', `%${skillStr}%`).neq('user_id', user.id);
    if (type === 'learn') query = query.eq('is_teaching', true);
    else query = query.eq('is_learning', true);
    const { data, error } = await query.limit(20);
    if (error) throw new APIError(error.message, 500);
    if (!data || data.length === 0) return null;
    const matchDb = data[Math.floor(Math.random() * data.length)];
    return { id: matchDb.users.id, name: matchDb.users.name, initials: (matchDb.users.name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(), color: matchDb.users.avatar_color, skill: type === 'learn' ? `Teaches: ${matchDb.name}` : `Wants to learn: ${matchDb.name}`, skill_id: matchDb.id };
  },

  async createMatchBooking(peerId, skillId) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { data, error } = await supabase.from('bookings').insert({
      learner_id: user.id, teacher_id: peerId, skill_id: skillId, skill_name: 'Match Negotiation',
      scheduled_date: new Date().toISOString().split('T')[0], start_time: '12:00', duration_mins: 60, coin_rate: 1.0, escrow_amount: 1.0, status: 'pending'
    }).select('id').single();
    if (error) throw new APIError(error.message, 500);
    return data.id;
  }
};
