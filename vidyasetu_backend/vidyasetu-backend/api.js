/**
 * api.js — Vidyasetu Frontend API Layer
 * ─────────────────────────────────────────────────────────────
 * Drop-in replacement for all the static/mock data in the HTML pages.
 * Add to every inner page: <script src="api.js"></script>
 *
 * Requires:
 *   <script src="config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *
 * Usage:
 *   const teachers = await VS.teachers.list({ category: 'programming' });
 *   const balance  = await VS.coins.balance();
 *   await VS.auth.sendOtp(email, 'login');
 */

// ─── Supabase client (singleton) ─────────────────────────────
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const { createClient } = window.supabase;
    _supabase = createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_ANON_KEY
    );
  }
  return _supabase;
}

// ─── Core fetch wrapper (authenticated) ──────────────────────
async function edgeFn(endpoint, payload = {}, requireAuth = true) {
  const supabase = getSupabase();
  const headers  = { 'Content-Type': 'application/json' };

  if (requireAuth) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `02_login.html?redirect=${redirect}`;
      return null;
    }
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  try {
    const res  = await fetch(
      `${window.APP_CONFIG.SUPABASE_URL}/functions/v1/${endpoint}`,
      { method: 'POST', headers, body: JSON.stringify(payload) }
    );
    const data = await res.json();
    if (!res.ok) throw new APIError(data.error || 'Request failed', res.status);
    return data;
  } catch (err) {
    if (err instanceof APIError) throw err;
    throw new APIError('Network error. Check your connection.', 0);
  }
}

class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name    = 'APIError';
    this.status  = status;
  }
}

// ─── VS global namespace ─────────────────────────────────────
window.VS = {

  // ──────────────────────────────────────────────────────────
  // AUTH
  // ──────────────────────────────────────────────────────────
  auth: {
    async sendOtp(email, purpose) {
      return edgeFn('send-otp', { email, purpose }, false);
    },

    async verifyOtp(email, otp, purpose, extraFields = {}) {
      const result = await edgeFn('verify-otp', { email, otp, purpose, ...extraFields }, false);
      if (result) {
        // Persist session state to localStorage
        localStorage.setItem('vs_logged_in', 'true');
        localStorage.setItem('vs_user_id',   result.user_id);
        localStorage.setItem('vs_coins',     String(result.coins ?? 0));
        if (result.name)  localStorage.setItem('vs_user_name', result.name);
        if (result.role)  localStorage.setItem('vs_user_role', result.role);
        if (result.level) localStorage.setItem('vs_user_level', String(result.level));
        if (result.xp)    localStorage.setItem('vs_user_xp', String(result.xp));
      }
      return result;
    },

    async getSession() {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    },

    async getUser() {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },

    logout() {
      localStorage.removeItem('vs_logged_in');
      localStorage.removeItem('vs_user_id');
      localStorage.removeItem('vs_coins');
      localStorage.removeItem('vs_user_name');
      localStorage.removeItem('vs_user_role');
      localStorage.removeItem('vs_user_level');
      localStorage.removeItem('vs_user_xp');
      const supabase = getSupabase();
      supabase.auth.signOut().finally(() => {
        window.location.href = '01_landing.html';
      });
    },

    // Guard: redirect to login if not authenticated
    async requireLogin() {
      const loggedIn = localStorage.getItem('vs_logged_in') === 'true';
      if (!loggedIn) {
        const redirect = encodeURIComponent(window.location.pathname);
        window.location.href = `02_login.html?redirect=${redirect}`;
        return false;
      }
      return true;
    },
  },

  // ──────────────────────────────────────────────────────────
  // COINS & WALLET
  // ──────────────────────────────────────────────────────────
  coins: {
    async balance() {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('get_coin_balance');
      if (error) throw new APIError(error.message, 500);
      const coins = Number(data ?? 0);
      localStorage.setItem('vs_coins', String(coins));
      // Update any coin displays on the page
      document.querySelectorAll('[data-coin-balance]').forEach(el => {
        el.textContent = `🪙 ${coins}`;
      });
      return coins;
    },

    async history({ type = null, limit = 20, offset = 0 } = {}) {
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase.rpc('get_wallet_history', {
        p_user_id: user.id,
        p_type:    type,
        p_limit:   limit,
        p_offset:  offset,
      });
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },
  },

  // ──────────────────────────────────────────────────────────
  // TEACHERS
  // ──────────────────────────────────────────────────────────
  teachers: {
    async list({ category = null, tier = null, search = null,
                 sort = 'rating', limit = 20, offset = 0 } = {}) {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('get_teacher_profiles', {
        p_category: category,
        p_tier:     tier,
        p_search:   search,
        p_sort:     sort,
        p_limit:    limit,
        p_offset:   offset,
      });
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },

    async get(userId) {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, name, college, avatar_color, bio, xp, level, last_active_at,
          skills!inner(id, name, category, tier, coin_rate, is_teaching)
        `)
        .eq('id', userId)
        .eq('is_banned', false)
        .single();
      if (error) throw new APIError(error.message, 500);
      return data;
    },
  },

  // ──────────────────────────────────────────────────────────
  // BOOKINGS / SESSIONS
  // ──────────────────────────────────────────────────────────
  sessions: {
    async book(payload) {
      return edgeFn('book-session', payload);
    },

    async complete(bookingId, elapsedSeconds, { rating, review, reason = 'completed' } = {}) {
      return edgeFn('complete-session', {
        booking_id:      bookingId,
        elapsed_seconds: elapsedSeconds,
        rating:          rating ?? null,
        review:          review ?? null,
        reason,
      });
    },

    async list(status = null) {
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) return { upcoming: [], completed: [] };

      let query = supabase
        .from('bookings')
        .select(`
          id, skill_name, topic, scheduled_date, start_time, duration_mins,
          coin_rate, escrow_amount, status, actual_start_at, actual_end_at,
          learner_rating, reviewed_at,
          learner:learner_id(id, name, avatar_color),
          teacher:teacher_id(id, name, avatar_color)
        `)
        .or(`learner_id.eq.${user.id},teacher_id.eq.${user.id}`)
        .order('scheduled_date', { ascending: false });

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw new APIError(error.message, 500);

      const now      = new Date();
      const upcoming = (data ?? []).filter(b =>
        ['pending','confirmed','active'].includes(b.status)
      );
      const completed = (data ?? []).filter(b =>
        ['completed','partial_refund','refunded','cancelled'].includes(b.status)
      );
      return { upcoming, completed };
    },

    async sendHeartbeat(bookingId) {
      const supabase = getSupabase();
      await supabase.from('bookings')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('id', bookingId);
    },
  },

  // ──────────────────────────────────────────────────────────
  // BOUNTIES
  // ──────────────────────────────────────────────────────────
  bounties: {
    async list({ category = null, status = 'open', search = null,
                 sort = 'newest', limit = 20, offset = 0 } = {}) {
      const supabase = getSupabase();
      let query = supabase
        .from('bounties')
        .select(`
          id, title, description, category, tags, coin_reward,
          deadline_at, status, bid_count, created_at,
          poster:poster_id(id, name, avatar_color)
        `)
        .eq('status', status || 'open')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (category) query = query.eq('category', category);
      if (search) {
        query = query.or(
          `title.ilike.%${search}%,description.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },

    async post(payload) {
      return edgeFn('post-bounty', payload);
    },

    async submitBid(payload) {
      // payload.encrypted_proposal and payload.encryption_iv must be
      // AES-256-GCM encrypted client-side before calling this
      return edgeFn('submit-bid', payload);
    },

    // AES-256-GCM encryption helper for blind bids
    async encryptProposal(proposalText, posterPublicKey) {
      // Derive AES key from a random 256-bit key
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const iv      = crypto.getRandomValues(new Uint8Array(12));
      const key     = await crypto.subtle.importKey(
        'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']
      );
      const enc   = new TextEncoder();
      const cipherBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, enc.encode(proposalText)
      );
      const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      return {
        encrypted_proposal: toB64(cipherBuf),
        encryption_iv:      toB64(iv.buffer),
      };
    },
  },

  // ──────────────────────────────────────────────────────────
  // QUESTS
  // ──────────────────────────────────────────────────────────
  quests: {
    async list() {
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) return [];

      const today = new Date(); today.setUTCHours(0,0,0,0);

      const [{ data: quests }, { data: progress }] = await Promise.all([
        supabase.from('quests').select('*').eq('is_active', true).order('type'),
        supabase.from('user_quest_progress')
          .select('*')
          .eq('user_id', user.id)
          .gte('period_start', today.toISOString()),
      ]);

      return (quests ?? []).map(q => {
        const p = (progress ?? []).find(x => x.quest_id === q.id);
        return {
          ...q,
          progress:  p?.progress  ?? 0,
          completed: p?.completed ?? false,
          claimed:   p?.claimed   ?? false,
        };
      });
    },

    async claim(questId) {
      const result = await edgeFn('claim-quest', { quest_id: questId });
      if (result) {
        // Update local coin balance
        const currentCoins = parseInt(localStorage.getItem('vs_coins') || '0');
        const newCoins      = currentCoins + Number(result.coins_awarded ?? 0);
        localStorage.setItem('vs_coins', String(newCoins));
      }
      return result;
    },
  },

  // ──────────────────────────────────────────────────────────
  // LEADERBOARD
  // ──────────────────────────────────────────────────────────
  leaderboard: {
    async get(period = 'weekly', limit = 20) {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('get_leaderboard', {
        p_period: period,
        p_limit:  limit,
      });
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROFILE
  // ──────────────────────────────────────────────────────────
  profile: {
    async get() {
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) return null;

      const [{ data: profile }, { data: skills }, { data: badges }] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase.from('skills').select('*').eq('user_id', user.id),
        supabase.from('user_badges').select('*').eq('user_id', user.id),
      ]);
      return { ...profile, skills: skills ?? [], badges: badges ?? [] };
    },

    async update(fields) {
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { error } = await supabase
        .from('users')
        .update(fields)
        .eq('id', user.id);
      if (error) throw new APIError(error.message, 500);
    },
  },

  // ──────────────────────────────────────────────────────────
  // SKILL VERIFICATION
  // ──────────────────────────────────────────────────────────
  verify: {
    async getQuestions(skillName, count = 10) {
      const supabase = getSupabase();
      // Fetch questions WITHOUT the correct field (server strips it in a real setup)
      // For now we fetch all fields but the MCQ page validates server-side
      const { data, error } = await supabase
        .from('mcq_questions')
        .select('id, question, option_a, option_b, option_c, option_d, difficulty')
        .eq('skill_name', skillName)
        .eq('is_active', true)
        .order('RANDOM()')  // PostgreSQL random
        .limit(count);
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },

    async submitAttempt(skillName, answers) {
      // answers: [{question_id, selected_option (0-3)}, ...]
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      // Check attempt count in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const { count } = await supabase
        .from('skill_verifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('skill_name', skillName)
        .gte('started_at', thirtyDaysAgo);

      if ((count ?? 0) >= 3) {
        throw new APIError('Maximum 3 attempts per skill per 30 days.', 429);
      }

      // Fetch correct answers server-side
      const questionIds = answers.map(a => a.question_id);
      const { data: questions } = await supabase
        .from('mcq_questions')
        .select('id, correct')
        .in('id', questionIds);

      // Score locally (in production, this would be Edge Function)
      const qMap   = Object.fromEntries((questions ?? []).map(q => [q.id, q.correct]));
      const correct = answers.filter(a => qMap[a.question_id] === a.selected_option).length;
      const pct     = Math.round((correct / answers.length) * 100);
      const tier    = pct >= 95 ? 'gold' : pct >= 85 ? 'silver' : pct >= 70 ? 'bronze' : null;
      const passed  = tier !== null;

      // Record the attempt
      await supabase.from('skill_verifications').insert({
        user_id:      user.id,
        skill_name:   skillName,
        score:        correct,
        pct,
        tier_awarded: tier,
        passed,
        completed_at: new Date().toISOString(),
      });

      // Update skill tier if passed
      if (passed) {
        const { data: existingSkill } = await supabase
          .from('skills')
          .select('id, tier')
          .eq('user_id', user.id)
          .eq('name', skillName)
          .single();

        const tierRank = { bronze: 1, silver: 2, gold: 3 };
        const shouldUpgrade = !existingSkill ||
          (tierRank[tier] > (tierRank[existingSkill.tier] ?? 0));

        if (shouldUpgrade) {
          const coinRate = tier === 'gold' ? 2.0 : tier === 'silver' ? 1.5 : 1.0;
          if (existingSkill) {
            await supabase.from('skills')
              .update({ tier, coin_rate: coinRate, verified_at: new Date().toISOString() })
              .eq('id', existingSkill.id);
          } else {
            await supabase.from('skills').insert({
              user_id: user.id, name: skillName, tier, coin_rate: coinRate,
              is_teaching: true, verified_at: new Date().toISOString(),
              category: 'programming', // default; user can update later
            });
          }
        }
      }

      return { correct, total: answers.length, pct, tier, passed };
    },
  },

  // ──────────────────────────────────────────────────────────
  // CHAT (Realtime)
  // ──────────────────────────────────────────────────────────
  chat: {
    async send(bookingId, content, msgType = 'text') {
      const supabase = getSupabase();
      const user     = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { error } = await supabase.from('chat_messages').insert({
        booking_id: bookingId,
        sender_id:  user.id,
        content,
        msg_type:   msgType,
      });
      if (error) throw new APIError(error.message, 500);
    },

    async history(bookingId, limit = 50) {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, sender_id, content, msg_type, file_url, created_at')
        .eq('booking_id', bookingId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },

    subscribe(bookingId, onMessage) {
      const supabase = getSupabase();
      return supabase
        .channel(`chat:${bookingId}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'chat_messages',
          filter: `booking_id=eq.${bookingId}`,
        }, (payload) => onMessage(payload.new))
        .subscribe();
    },

    unsubscribe(channel) {
      if (channel) getSupabase().removeChannel(channel);
    },
  },

  // ──────────────────────────────────────────────────────────
  // COIN REALTIME UPDATES
  // ──────────────────────────────────────────────────────────
  watchCoins(onUpdate) {
    return getSupabase()
      .channel('coins:' + localStorage.getItem('vs_user_id'))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'coin_ledger',
        filter: `user_id=eq.${localStorage.getItem('vs_user_id')}`,
      }, async (payload) => {
        // Recalculate and update balance
        const newBalance = await VS.coins.balance();
        if (onUpdate) onUpdate(newBalance, payload.new);
      })
      .subscribe();
  },
};
