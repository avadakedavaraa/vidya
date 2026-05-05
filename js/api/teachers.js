/**
 * js/api/teachers.js — Teacher profiles, search, broadcasting, and stats.
 */
import { getSupabase, APIError } from './client.js';

export const teachers = {
  async list({ category = null, tier = null, search = null, sort = 'rating', limit = 20, offset = 0 } = {}) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_teacher_profiles', { p_category: category, p_tier: tier, p_search: search, p_sort: sort, p_limit: limit, p_offset: offset });
    if (error) throw new APIError(error.message, 500);
    return data ?? [];
  },

  async get(userId) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('users').select(`id, name, college, avatar_color, bio, xp, level, last_active_at, skills(id, name, category, tier, coin_rate, is_teaching)`).eq('id', userId).eq('is_banned', false).single();
    if (error) throw new APIError(error.message, 500);
    if (data.skills) {
      data.teaches = data.skills.filter(s => s.is_teaching);
      data.rate = data.skills.find(s => s.is_teaching)?.coin_rate || 2;
    }
    return data;
  },

  async broadcast(skillName, category = 'other') {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { data: verifications } = await supabase.from('skill_verifications').select('id, tier_awarded, passed, pct').eq('user_id', user.id).ilike('skill_name', skillName.trim()).eq('passed', true).order('completed_at', { ascending: false }).limit(1);
    if (!verifications || verifications.length === 0) return { qualified: false, skillName: skillName.trim() };
    const bestTier = verifications[0].tier_awarded || 'bronze';
    const { error } = await supabase.from('skills').upsert({ user_id: user.id, name: skillName.trim(), category, is_teaching: true, is_learning: false, tier: bestTier }, { onConflict: 'user_id,name', ignoreDuplicates: false });
    if (error) {
      const { error: err2 } = await supabase.from('skills').insert({ user_id: user.id, name: skillName.trim(), category, is_teaching: true, is_learning: false, tier: bestTier });
      if (err2) throw new APIError(err2.message, 500);
    }
    await supabase.from('users').update({ role: 'both' }).eq('id', user.id);
    return { qualified: true, tier: bestTier };
  },

  async myStudents() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { data: sessions, error } = await supabase.from('bookings').select('id, status, skill_name, topic, scheduled_date, start_time, duration_mins, coin_rate, learner_rating, learner_review, reviewed_at, learner:learner_id(id, name, avatar_color)').eq('teacher_id', user.id).order('scheduled_date', { ascending: false });
    if (error) throw new APIError(error.message, 500);
    return (sessions || []).map(s => ({
      id: s.id, status: s.status, skill: s.skill_name, topic: s.topic, date: s.scheduled_date, time: s.start_time, durationMins: s.duration_mins, coinRate: s.coin_rate,
      student: { id: s.learner?.id, name: s.learner?.name || 'Student', initials: (s.learner?.name || 'S').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(), color: s.learner?.avatar_color || 'var(--primary)' },
      rating: s.learner_rating, review: s.learner_review, reviewedAt: s.reviewed_at,
    }));
  },

  async setAvailability(isAvailable) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { error } = await supabase.from('users').update({ is_available: isAvailable, last_active_at: new Date().toISOString() }).eq('id', user.id);
    if (error) throw new APIError(error.message, 500);
  },

  async myStats() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    const { data: skills } = await supabase.from('skills').select('id, name, category, tier, coin_rate, is_teaching').eq('user_id', user.id).eq('is_teaching', true);
    const { data: sessions } = await supabase.from('bookings').select('id, status, learner_rating, learner_review, coin_rate, duration_mins, scheduled_date, skill_name, learner:learner_id(id, name, avatar_color)').eq('teacher_id', user.id).order('scheduled_date', { ascending: false });
    const completed = (sessions || []).filter(s => s.status === 'completed');
    const pending = (sessions || []).filter(s => ['pending', 'confirmed'].includes(s.status));
    const ratings = completed.filter(s => s.learner_rating).map(s => s.learner_rating);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    const { data: earnings } = await supabase.from('coin_ledger').select('amount').eq('user_id', user.id).eq('type', 'session_earned');
    const totalEarned = (earnings || []).reduce((s, e) => s + Number(e.amount), 0);
    const { count: unreadDMs } = await supabase.from('direct_messages').select('*', { count: 'exact', head: true }).eq('receiver_id', user.id).eq('is_read', false);
    return { skills: skills || [], studentsCount: new Set(completed.map(s => s.learner?.id).filter(Boolean)).size, totalSessions: completed.length, pendingRequests: pending, recentReviews: completed.filter(s => s.learner_review).slice(0, 5), avgRating: Number(avgRating.toFixed(1)), totalEarned, unreadDMs: unreadDMs || 0 };
  },

  async getAll() {
    const list = await teachers.list().catch(() => []);
    if (!list.length) return [];
    
    const supabase = getSupabase();
    const { data: allSkills } = await supabase.from('skills')
      .select('user_id, name')
      .in('user_id', list.map(t => t.id))
      .eq('is_teaching', true);
      
    const skillsMap = {};
    (allSkills || []).forEach(s => {
      if (!skillsMap[s.user_id]) skillsMap[s.user_id] = [];
      skillsMap[s.user_id].push(s.name);
    });

    return list.map(t => ({
      id: t.id, name: t.name, initials: (t.name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(), color: t.avatar_color || 'var(--indigo)', college: t.college || 'Verified Expert', rating: typeof t.rating === 'number' ? t.rating : 5.0, reviews: typeof t.reviews === 'number' ? t.reviews : 0, sessions: typeof t.sessions_taught === 'number' ? t.sessions_taught : 0, online: false, tier: t.skill_tier || t.tier || 'unverified', teaches: skillsMap[t.id] && skillsMap[t.id].length ? skillsMap[t.id] : [t.skill_name || t.primary_skill].filter(Boolean), wants: [], rate: typeof t.coin_rate === 'number' ? t.coin_rate : 2, category: t.category || 'other', bio: t.bio || 'Verified VidyaSetu expert.'
    }));
  },

  async exploreStudents({ category = null, search = null } = {}) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);
    let query = supabase.from('skills').select(`id, name, category, created_at, users!inner(id, name, avatar_color, college, bio, xp, level)`).eq('is_learning', true).neq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
    if (category && category !== 'all') query = query.eq('category', category);
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query;
    if (error) throw new APIError(error.message, 500);
    const studentMap = {};
    (data || []).forEach(s => {
      const uid = s.users.id;
      if (!studentMap[uid]) {
        studentMap[uid] = { id: uid, name: s.users.name || 'Student', initials: (s.users.name || 'S').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(), color: s.users.avatar_color || 'var(--primary)', college: s.users.college || 'VidyaSetu Learner', bio: s.users.bio || '', xp: s.users.xp || 0, level: s.users.level || 1, wantsToLearn: [] };
      }
      studentMap[uid].wantsToLearn.push({ name: s.name, category: s.category });
    });
    return Object.values(studentMap);
  },

  async getStats(userId) {
    const supabase = getSupabase();
    const { data: sessions, error } = await supabase
      .from('bookings')
      .select('status, learner_rating, learner_review, reviewed_at, learner:learner_id(name, avatar_color)')
      .eq('teacher_id', userId);

    if (error) throw new APIError(error.message, 500);

    const completed = (sessions || []).filter(s => s.status === 'completed');
    const reviews = completed
      .filter(s => s.learner_rating || s.learner_review)
      .map(s => ({
        rating: s.learner_rating,
        review: s.learner_review,
        date: s.reviewed_at,
        learnerName: s.learner?.name || 'Anonymous',
        learnerColor: s.learner?.avatar_color || 'var(--indigo)'
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const ratings = reviews.filter(r => r.rating).map(r => r.rating);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    ratings.forEach(r => { if (distribution[r] !== undefined) distribution[r]++; });

    return {
      totalSessions: completed.length,
      avgRating: Number(avgRating.toFixed(1)),
      reviewsCount: reviews.length,
      distribution,
      recentReviews: reviews.slice(0, 3)
    };
  },

  async saveWeeklyAvailability(slots) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);

    // slots: Array of { day_of_week, start_time, end_time }
    // 0=Sun, 1=Mon...
    
    // Clear existing recurring slots
    await supabase.from('availability_slots').delete().eq('teacher_id', user.id).eq('is_recurring', true);
    
    if (slots.length > 0) {
      const { error } = await supabase.from('availability_slots').insert(
        slots.map(s => ({
          teacher_id: user.id,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          is_recurring: true,
          is_active: true
        }))
      );
      if (error) throw new APIError(error.message, 500);
    }
    
    return { success: true };
  },

  async getWeeklyAvailability(userId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('availability_slots')
      .select('*')
      .eq('teacher_id', userId)
      .eq('is_recurring', true)
      .eq('is_active', true);
    
    if (error) throw new APIError(error.message, 500);
    return data || [];
  },

  async notifyMatchingLearners(skillName, availabilityNote) {
    const supabase = getSupabase();
    const { data: { user: teacher } } = await supabase.auth.getUser();
    if (!teacher) return;

    // Find learners wanting this skill
    const { data: learners } = await supabase
      .from('skills')
      .select('user_id')
      .eq('is_learning', true)
      .ilike('name', skillName.trim())
      .neq('user_id', teacher.id);
    
    if (!learners || learners.length === 0) return { count: 0 };

    const uniqueLearners = [...new Set(learners.map(l => l.user_id))];
    const message = `👋 Hey! I'm now available to teach ${skillName}. \n\nMy schedule: ${availabilityNote}\n\nCheck my profile to book a session!`;

    // Send system messages
    const { error } = await supabase.from('direct_messages').insert(
      uniqueLearners.map(lid => ({
        sender_id: teacher.id,
        receiver_id: lid,
        content: message,
        msg_type: 'system'
      }))
    );
    
    return { count: uniqueLearners.length, error };
  },

  async removeSkill(skillId) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);

    const { error } = await supabase
      .from('skills')
      .delete()
      .eq('id', skillId)
      .eq('user_id', user.id);
    
    if (error) throw new APIError(error.message, 500);
    return true;
  },

  async updateSkill(skillId, updates) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new APIError('Not authenticated', 401);

    const { error } = await supabase
      .from('skills')
      .update(updates)
      .eq('id', skillId)
      .eq('user_id', user.id);
    
    if (error) throw new APIError(error.message, 500);
    return true;
  }
};
