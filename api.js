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
  const headers = { 'Content-Type': 'application/json' };

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
    const res = await fetch(
      `/api/${endpoint}`,
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
    this.name = 'APIError';
    this.status = status;
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
        localStorage.setItem('vs_user_id', result.user_id);
        localStorage.setItem('vs_coins', String(result.coins ?? 0));
        if (result.name) localStorage.setItem('vs_user_name', result.name);
        if (result.role) localStorage.setItem('vs_user_role', result.role);
        if (result.level) localStorage.setItem('vs_user_level', String(result.level));
        if (result.xp) localStorage.setItem('vs_user_xp', String(result.xp));
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
      // Clear all local state including demo mode
      ['vs_logged_in', 'vs_user_id', 'vs_coins', 'vs_user_name',
        'vs_user_role', 'vs_user_level', 'vs_user_xp', 'vs_demo_mode'].forEach(k => localStorage.removeItem(k));
      const supabase = getSupabase();
      supabase.auth.signOut().finally(() => {
        localStorage.clear();
        window.location.href = 'index.html';
      });
    },

    // Alias — many pages call VS.auth.signOut() instead of VS.auth.logout()
    signOut() {
      return this.logout();
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

    /** Fast synchronous check */
    isLoggedIn() {
      return localStorage.getItem('vs_logged_in') === 'true';
    },

    /** Quick cached user info */
    currentUser() {
      const name = localStorage.getItem('vs_user_name') || 'User';
      const id = localStorage.getItem('vs_user_id');
      const email = '';
      const coins = parseInt(localStorage.getItem('vs_coins') || '0', 10);
      return id ? { id, name, email, coins } : null;
    },

    /** Login with email + password (Supabase Auth) */
    async loginWithPassword(email, password) {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });
      if (error) throw new APIError(error.message, error.status || 400);

      const user = data?.user;
      if (!user) throw new APIError('Login failed.', 400);

      // Fetch profile
      const { data: profile } = await sb.from('users')
        .select('name, coins').eq('id', user.id).maybeSingle();

      localStorage.setItem('vs_logged_in', 'true');
      localStorage.setItem('vs_user_id', user.id);
      localStorage.setItem('vs_user_name', profile?.name ?? user.email.split('@')[0]);
      localStorage.setItem('vs_coins', String(profile?.coins ?? 0));

      return { success: true, id: user.id, name: profile?.name, coins: profile?.coins ?? 0 };
    },

    /** Sign up with email + password (Supabase Auth) */
    async signupWithPassword(email, password, extra = {}) {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signUp({
        email: email.toLowerCase().trim(),
        password,
        options: { data: extra },
      });
      if (error) {
        if (error.message?.toLowerCase().includes('already registered'))
          throw new APIError('This email is already registered. Please sign in instead.', 409);
        throw new APIError(error.message || 'Signup failed.', error.status || 400);
      }
      return { success: true };
    },

    /** Verify OTP — uppercase alias used by 02_login.html */
    async verifyOTP(email, otp, purpose = 'signup', extra = {}) {
      const sb = getSupabase();
      const { data, error } = await sb.auth.verifyOtp({
        email: email.toLowerCase().trim(),
        token: otp.trim(),
        type: (purpose === 'signup' || purpose === 'login') ? 'signup' : 'recovery',
      });
      if (error) throw new APIError(error.message, error.status || 400);

      const user = data?.user;
      if (!user) throw new APIError('Verification failed.', 400);

      // Profile and welcome bonus are auto-created by Supabase DB Trigger on `auth.users`.
      // We just need to update any extra metadata provided during signup verification.
      if (purpose === 'signup') {
        await sb.from('users').update({
          name: extra.name || user.email.split('@')[0],
          role: extra.role || 'both'
        }).eq('id', user.id);
      }

      const { data: profile } = await sb.from('users')
        .select('name, coins').eq('id', user.id).maybeSingle();

      localStorage.setItem('vs_logged_in', 'true');
      localStorage.setItem('vs_user_id', user.id);
      localStorage.setItem('vs_user_name', profile?.name ?? extra.name ?? user.email.split('@')[0]);
      localStorage.setItem('vs_coins', String(profile?.coins ?? 2));

      return { success: true, id: user.id, name: profile?.name, coins: profile?.coins ?? 2 };
    },

    /** Send OTP for passwordless auth — uppercase alias */
    async sendOTP(email, purpose = 'login') {
      const sb = getSupabase();
      if (purpose === 'reset_password') {
        const { error } = await sb.auth.resetPasswordForEmail(email.toLowerCase().trim());
        if (error) throw new APIError(error.message, error.status || 400);
      } else {
        const { error } = await sb.auth.signInWithOtp({
          email: email.toLowerCase().trim(),
          options: { shouldCreateUser: purpose === 'signup' },
        });
        if (error) throw new APIError(error.message, error.status || 400);
      }
      return { success: true };
    },

    /** Update password (must be logged in) */
    async updatePassword(newPassword) {
      const sb = getSupabase();
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw new APIError(error.message, error.status || 400);
      return { success: true };
    },

    /** Google OAuth login */
    async loginWithGoogle(redirectAfter = '03_dashboard.html') {
      const sb = getSupabase();

      // 1. Local file:// (file protocol)
      // 2. localhost / dev server
      // 3. Production domain (Vercel with cleanUrls)
      let origin = window.location.origin;
      let callbackPath = window.location.pathname.includes('.html') ? '/02_login.html' : '/02_login';
      let callbackUrl = origin + callbackPath + '?auth_callback=1&redirect=' + encodeURIComponent(redirectAfter);

      // file:// origin is "null" — fallback to Supabase URL so redirect completes
      if (!origin || origin === 'null' || origin === 'file://') {
        callbackUrl = window.APP_CONFIG.SUPABASE_URL + '/02_login.html?auth_callback=1&redirect=' + encodeURIComponent(redirectAfter);
      }

      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
          queryParams: { access_type: 'offline', prompt: 'consent' },
          skipBrowserRedirect: false,
        },
      });
      if (error) throw new APIError(error.message, error.status || 400);
    },

    /** Handle OAuth callback on login page load */
    async handleOAuthCallback() {
      const sb = getSupabase();
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash;

      // Supabase puts the session in:
      // 1. URL hash as #access_token=... (implicit flow)
      // 2. URL search as ?auth_callback=1 (our custom marker)
      // 3. Already stored in the session (PKCE flow)
      const hasCallback = params.get('auth_callback') === '1';
      const hasHashToken = hash.includes('access_token=');
      const hasHashError = hash.includes('error=');

      // Also check if we just came back from OAuth even without our marker
      // (happens when redirectTo doesn't include our query param)
      const { data: existingSession } = await sb.auth.getSession();
      const justLoggedIn = existingSession?.session &&
        !localStorage.getItem('vs_logged_in') &&
        existingSession.session.user?.app_metadata?.provider === 'google';

      if (!hasCallback && !hasHashToken && !hasHashError && !justLoggedIn) {
        return;
      }

      // Wait a tick for Supabase to process the hash/code
      await new Promise(r => setTimeout(r, 100));

      const { data, error: sessionError } = await sb.auth.getSession();
      if (sessionError || !data?.session) {
        // If we had a hash error, show it
        if (hasHashError) {
          const errMatch = hash.match(/error_description=([^&]+)/);
          if (errMatch) console.error('OAuth error:', decodeURIComponent(errMatch[1]));
        }
        return;
      }

      const user = data.session.user;
      const googleName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
      const initials = googleName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      // Upsert app profile
      await sb.from('users').upsert({
        id: user.id,
        email: user.email,
        name: googleName,
        role: 'both',
        avatar_color: '#5B45E0',
      }, { onConflict: 'id' });

      // Welcome bonus (INSERT IGNORE — won't duplicate due to ledger design)
      await sb.from('coin_ledger').insert({
        user_id: user.id, amount: 2, type: 'welcome_bonus', note: 'Welcome to Vidyasetu! 🎉'
      });

      // Get final profile with coin balance
      const { data: profile } = await sb.from('users')
        .select('name').eq('id', user.id).maybeSingle();

      const coinBalance = await sb.rpc('get_coin_balance', { p_user_id: user.id })
        .then(r => Number(r.data ?? 2)).catch(() => 2);

      localStorage.setItem('vs_logged_in', 'true');
      localStorage.setItem('vs_user_id', user.id);
      localStorage.setItem('vs_user_name', profile?.name ?? googleName);
      localStorage.setItem('vs_coins', String(coinBalance));

      // Clean up hash before redirecting (prevents re-processing)
      if (window.history?.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }

      const redirectTarget = params.get('redirect') || '03_dashboard.html';
      window.location.replace(redirectTarget);
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
      const user = await VS.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase.rpc('get_wallet_history', {
        p_user_id: user.id,
        p_type: type,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },

    async getStats() {
      const supabase = getSupabase();
      const user = VS.auth.currentUser();
      if (!user) return null;

      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      try {
        const [monthRes, totalRes, escrowRes] = await Promise.all([
          supabase.from('coin_ledger')
            .select('amount')
            .eq('user_id', user.id)
            .gte('created_at', firstDay),
          supabase.from('coin_ledger')
            .select('amount')
            .eq('user_id', user.id)
            .gt('amount', 0),
          supabase.from('bookings')
            .select('escrow_amount, released_amount')
            .eq('learner_id', user.id)
            .in('status', ['confirmed', 'active'])
        ]);

        let monthEarned = 0, monthSpent = 0;
        (monthRes.data || []).forEach(t => {
          const amt = Number(t.amount);
          if (amt > 0) monthEarned += amt;
          else monthSpent += Math.abs(amt);
        });

        let totalEarnedEver = 0;
        (totalRes.data || []).forEach(t => { totalEarnedEver += Number(t.amount); });

        let inEscrow = 0;
        (escrowRes.data || []).forEach(b => {
          inEscrow += (Number(b.escrow_amount) - Number(b.released_amount || 0));
        });

        return { monthEarned, monthSpent, inEscrow, totalEarnedEver };
      } catch (err) {
        console.error('getStats failed:', err);
        return { monthEarned: 0, monthSpent: 0, inEscrow: 0, totalEarnedEver: 0 };
      }
    }
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
        p_tier: tier,
        p_search: search,
        p_sort: sort,
        p_limit: limit,
        p_offset: offset,
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

    /** Broadcast a teaching skill — requires passing skill verification first */
    async broadcast(skillName, category = 'other') {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      // ── QUALIFICATION CHECK ──
      // Check if user has passed a skill verification for this skill
      const { data: verifications } = await supabase
        .from('skill_verifications')
        .select('id, tier_awarded, passed, pct')
        .eq('user_id', user.id)
        .ilike('skill_name', skillName.trim())
        .eq('passed', true)
        .order('completed_at', { ascending: false })
        .limit(1);

      if (!verifications || verifications.length === 0) {
        // Not qualified — return special result so UI can redirect
        return { qualified: false, skillName: skillName.trim() };
      }

      const bestTier = verifications[0].tier_awarded || 'bronze';

      // ── INSERT / UPSERT SKILL ──
      const { error } = await supabase.from('skills').upsert({
        user_id: user.id,
        name: skillName.trim(),
        category,
        is_teaching: true,
        is_learning: false,
        tier: bestTier,
      }, { onConflict: 'user_id,name', ignoreDuplicates: false });
      if (error) {
        const { error: err2 } = await supabase.from('skills').insert({
          user_id: user.id,
          name: skillName.trim(),
          category,
          is_teaching: true,
          is_learning: false,
          tier: bestTier,
        });
        if (err2) throw new APIError(err2.message, 500);
      }
      await supabase.from('users').update({ role: 'both' }).eq('id', user.id);
      return { qualified: true, tier: bestTier };
    },

    /** Get students I taught or will teach, with reviews */
    async myStudents() {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      const { data: sessions, error } = await supabase.from('bookings')
        .select('id, status, skill_name, topic, scheduled_date, start_time, duration_mins, coin_rate, learner_rating, learner_review, reviewed_at, learner:learner_id(id, name, avatar_color)')
        .eq('teacher_id', user.id)
        .order('scheduled_date', { ascending: false });
      if (error) throw new APIError(error.message, 500);

      return (sessions || []).map(s => ({
        id: s.id,
        status: s.status,
        skill: s.skill_name,
        topic: s.topic,
        date: s.scheduled_date,
        time: s.start_time,
        durationMins: s.duration_mins,
        coinRate: s.coin_rate,
        student: {
          id: s.learner?.id,
          name: s.learner?.name || 'Student',
          initials: (s.learner?.name || 'S').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
          color: s.learner?.avatar_color || 'var(--primary)',
        },
        rating: s.learner_rating,
        review: s.learner_review,
        reviewedAt: s.reviewed_at,
      }));
    },

    /** Toggle teacher availability */
    async setAvailability(isAvailable) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { error } = await supabase.from('users')
        .update({ is_available: isAvailable, last_active_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) throw new APIError(error.message, 500);
    },

    /** Get my teaching stats */
    async myStats() {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      // Active teaching skills
      const { data: skills } = await supabase.from('skills')
        .select('id, name, category, tier, coin_rate, is_teaching')
        .eq('user_id', user.id).eq('is_teaching', true);

      // Sessions where I'm the teacher
      const { data: sessions } = await supabase.from('bookings')
        .select('id, status, learner_rating, learner_review, coin_rate, duration_mins, scheduled_date, skill_name, learner:learner_id(id, name, avatar_color)')
        .eq('teacher_id', user.id)
        .order('scheduled_date', { ascending: false });

      const completed = (sessions || []).filter(s => s.status === 'completed');
      const pending = (sessions || []).filter(s => ['pending', 'confirmed'].includes(s.status));
      const ratings = completed.filter(s => s.learner_rating).map(s => s.learner_rating);
      const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;

      // Earnings from coin_ledger
      const { data: earnings } = await supabase.from('coin_ledger')
        .select('amount').eq('user_id', user.id).eq('type', 'session_earned');
      const totalEarned = (earnings || []).reduce((s, e) => s + Number(e.amount), 0);

      // Unread DMs
      const { count: unreadDMs } = await supabase.from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', user.id).eq('is_read', false);

      return {
        skills: skills || [],
        studentsCount: new Set(completed.map(s => s.learner?.id).filter(Boolean)).size,
        totalSessions: completed.length,
        pendingRequests: pending,
        recentReviews: completed.filter(s => s.learner_review).slice(0, 5),
        avgRating: Number(avgRating.toFixed(1)),
        totalEarned,
        unreadDMs: unreadDMs || 0,
      };
    },

    /** Proxy for dashboard/explore: transform RPC results to card-friendly format */
    async getAll() {
      const list = await VS.teachers.list().catch(() => []);
      return list.map(t => ({
        id: t.id,
        name: t.name,
        initials: (t.name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
        color: t.avatar_color || 'var(--indigo)',
        college: t.college || 'Verified Expert',
        rating: typeof t.rating === 'number' ? t.rating : 5.0,
        reviews: typeof t.reviews === 'number' ? t.reviews : 0,
        sessions: typeof t.sessions_taught === 'number' ? t.sessions_taught : 0,
        online: false,
        tier: t.tier || 'bronze',
        teaches: [t.primary_skill].filter(Boolean),
        wants: [],
        rate: typeof t.coin_rate === 'number' ? t.coin_rate : 2,
        category: t.category || 'other',
        bio: t.bio || 'Verified VidyaSetu expert.'
      }));
    },

    /** Explore students who want to learn — for teacher mode */
    async exploreStudents({ category = null, search = null } = {}) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      let query = supabase.from('skills')
        .select(`id, name, category, created_at, users!inner(id, name, avatar_color, college, bio, xp, level)`)
        .eq('is_learning', true)
        .neq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (category && category !== 'all') query = query.eq('category', category);
      if (search) query = query.ilike('name', `%${search}%`);

      const { data, error } = await query;
      if (error) throw new APIError(error.message, 500);

      // Group skills by student
      const studentMap = {};
      (data || []).forEach(s => {
        const uid = s.users.id;
        if (!studentMap[uid]) {
          studentMap[uid] = {
            id: uid,
            name: s.users.name || 'Student',
            initials: (s.users.name || 'S').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
            color: s.users.avatar_color || 'var(--primary)',
            college: s.users.college || 'VidyaSetu Learner',
            bio: s.users.bio || '',
            xp: s.users.xp || 0,
            level: s.users.level || 1,
            wantsToLearn: [],
          };
        }
        studentMap[uid].wantsToLearn.push({ name: s.name, category: s.category });
      });

      return Object.values(studentMap);
    },
  },

  // ──────────────────────────────────────────────────────────
  // BOOKINGS / SESSIONS
  // ──────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────
  // BOOKINGS / SESSIONS
  // ──────────────────────────────────────────────────────────
  sessions: {
    async book(payload) {
      return edgeFn('book-session', payload);
    },

    async heartbeat(bookingId) {
      const sb = getSupabase();
      await sb.from('bookings').update({ heartbeat_at: new Date().toISOString() }).eq('id', bookingId);
    },

    async complete(bookingId, elapsedSeconds, { rating, review, reason = 'completed' } = {}) {
      return edgeFn('complete-session', {
        booking_id: bookingId,
        elapsed_seconds: elapsedSeconds,
        rating: rating ?? null,
        review: review ?? null,
        reason,
      });
    },

    async list(status = null) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
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

      const processedData = data ?? [];

      const upcoming = processedData.filter(b =>
        ['pending', 'confirmed', 'active', 'soon', 'scheduled', 'tomorrow'].includes(b.status)
      );
      const completed = processedData.filter(b =>
        ['completed', 'partial_refund', 'refunded', 'cancelled'].includes(b.status)
      );
      return { upcoming, completed };
    },

    async getAll() {
      const res = await this.list();
      const user = VS.auth.currentUser();
      return {
        upcoming: res.upcoming.map(b => ({
          id: b.id,
          role: b.teacher?.id === user?.id ? 'teaching' : 'learning',
          name: b.teacher?.id === user?.id ? (b.learner?.name || 'Learner') : (b.teacher?.name || 'Teacher'),
          initials: (b.teacher?.id === user?.id ? (b.learner?.name || 'L') : (b.teacher?.name || 'T')).split(' ').map(n => n[0]).join('').substring(0, 2),
          color: b.teacher?.id === user?.id ? (b.learner?.avatar_color || '#16A27B') : (b.teacher?.avatar_color || '#5B45E0'),
          skill: b.skill_name,
          duration: (b.duration_mins / 60) + 'h',
          date: b.scheduled_date + ' · ' + b.start_time,
          coins: b.escrow_amount,
          status: b.status,
          statusLabel: b.status,
          canJoin: b.status === 'confirmed' || b.status === 'active'
        })),
        completed: res.completed
      };
    },

    async sendHeartbeat(bookingId) {
      const supabase = getSupabase();
      await supabase.from('bookings')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('id', bookingId);
    },
  },

  // ──────────────────────────────────────────────────────────
  // TRANSACTIONS
  // ──────────────────────────────────────────────────────────
  transactions: {
    async getAll() {
      const user = VS.auth.currentUser();
      if (!user) return [];
      const sb = getSupabase();
      const { data, error } = await sb.from('coin_ledger')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(t => ({
        type: t.amount > 0 ? 'plus' : 'minus',
        title: t.note || t.type.replace(/_/g, ' '),
        date: new Date(t.created_at).toLocaleDateString() + ' · ' + new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        amount: Math.abs(t.amount),
        raw_type: t.type
      }));
    }
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
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await crypto.subtle.importKey(
        'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']
      );
      const enc = new TextEncoder();
      const cipherBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, enc.encode(proposalText)
      );
      const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      return {
        encrypted_proposal: toB64(cipherBuf),
        encryption_iv: toB64(iv.buffer),
      };
    },

    /** Proxy: transform for dashboard cards */
    async getAll() {
      const list = await VS.bounties.list().catch(() => []);
      return list.map(b => ({
        id: b.id,
        title: b.title,
        desc: b.description,
        category: b.category,
        tags: b.tags,
        reward: b.coin_reward,
        bids: b.bid_count || 0,
        deadline: new Date(b.deadline_at).toLocaleDateString(),
        poster: b.poster?.name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '??',
        posterBg: b.poster?.avatar_color || 'var(--indigo)',
        status: b.status === 'open' ? 'new' : b.status
      }));
    },
  },

  // ──────────────────────────────────────────────────────────
  // QUESTS
  // ──────────────────────────────────────────────────────────
  quests: {
    async list() {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) return [];

      const today = new Date(); today.setUTCHours(0, 0, 0, 0);

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
          progress: p?.progress ?? 0,
          completed: p?.completed ?? false,
          claimed: p?.claimed ?? false,
        };
      });
    },

    async claim(questId) {
      const result = await edgeFn('claim-quest', { quest_id: questId });
      if (result) {
        // Update local coin balance
        const currentCoins = parseInt(localStorage.getItem('vs_coins') || '0');
        const newCoins = currentCoins + Number(result.coins_awarded ?? 0);
        localStorage.setItem('vs_coins', String(newCoins));
      }
      return result;
    },

    /** Proxy: transform for dashboard cards */
    async getAll() {
      const list = await VS.quests.list().catch(() => []);
      return list.map(q => ({
        id: q.id,
        type: q.type,
        icon: q.type === 'daily' ? '📅' : '🎯',
        iconBg: q.type === 'daily' ? 'var(--teal-light)' : 'var(--indigo-light)',
        title: q.title,
        desc: q.description || '',
        xp: 0,
        coins: q.coin_reward || q.coins,
        progress: q.progress || 0,
        target: q.target_count || q.target,
        done: q.completed || q.done
      }));
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
        p_limit: limit,
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
      const user = await VS.auth.getUser();
      if (!user) return null;

      const [{ data: profile }, { data: skills }, { data: badges }] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('skills').select('*').eq('user_id', user.id),
        supabase.from('user_badges').select('*').eq('user_id', user.id),
      ]);

      const result = { ...profile, id: user.id, email: user.email, skills: skills ?? [], badges: badges ?? [] };
      if (profile?.name) {
        localStorage.setItem('vs_user_name', profile.name);
      }
      return result;
    },

    async update(fields) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { error } = await supabase
        .from('users')
        .update(fields)
        .eq('id', user.id);
      if (error) throw new APIError(error.message, 500);
    },

    async delete() {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', user.id);
      if (error) throw new APIError(error.message, 500);
      // Sign out and redirect — auth.users row cleaned up by Supabase cascade
      VS.auth.logout();
    }
  },

  // ──────────────────────────────────────────────────────────
  // MATCHMAKING & SECURE CHAT
  // ──────────────────────────────────────────────────────────
  matchmaking: {
    async findMatch(type, skillStr) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      // 1. Enter our intent in the skills table so others can find us later
      // A genuine prod application would let the user pick the exact category or upsert cleanly.
      const mySkill = {
        user_id: user.id,
        name: skillStr,
        category: 'other',
        is_learning: type === 'learn',
        is_teaching: type === 'teach',
        tier: 'unverified'
      };
      // For prod: We just insert. If error, soft ignore (user likely already has the exact skill).
      await supabase.from('skills').insert(mySkill);

      // 2. Search for someone with the opposite intent!
      let query = supabase.from('skills')
        .select(`id, name, is_learning, is_teaching, users!inner(id, name, avatar_color)`)
        .ilike('name', `%${skillStr}%`)
        .neq('user_id', user.id);

      if (type === 'learn') query = query.eq('is_teaching', true);
      else query = query.eq('is_learning', true);

      const { data, error } = await query.limit(20);
      if (error) throw new APIError(error.message, 500);

      if (!data || data.length === 0) return null;

      const matchDb = data[Math.floor(Math.random() * data.length)];
      return {
        id: matchDb.users.id,
        name: matchDb.users.name,
        initials: (matchDb.users.name || 'U').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
        color: matchDb.users.avatar_color,
        skill: type === 'learn' ? `Teaches: ${matchDb.name}` : `Wants to learn: ${matchDb.name}`,
        skill_id: matchDb.id
      };
    },

    async createMatchBooking(peerId, skillId) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);

      const bookingData = {
        learner_id: user.id,
        teacher_id: peerId,
        skill_id: skillId,
        skill_name: 'Match Negotiation',
        scheduled_date: new Date().toISOString().split('T')[0],
        start_time: '12:00',
        duration_mins: 60,
        coin_rate: 1.0,
        escrow_amount: 1.0,
        status: 'pending'
      };

      const { data, error } = await supabase.from('bookings').insert(bookingData).select('id').single();
      if (error) throw new APIError(error.message, 500);
      return data.id;
    }
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
      const user = await VS.auth.getUser();
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
      const qMap = Object.fromEntries((questions ?? []).map(q => [q.id, q.correct]));
      const correct = answers.filter(a => qMap[a.question_id] === a.selected_option).length;
      const pct = Math.round((correct / answers.length) * 100);
      const tier = pct >= 95 ? 'gold' : pct >= 85 ? 'silver' : pct >= 70 ? 'bronze' : null;
      const passed = tier !== null;

      // Record the attempt
      await supabase.from('skill_verifications').insert({
        user_id: user.id,
        skill_name: skillName,
        score: correct,
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
  // DIRECT MESSAGES (Pre-booking 1:1 chat)
  // ──────────────────────────────────────────────────────────
  dm: {
    async send(receiverId, content) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      if (receiverId === user.id) throw new APIError('Cannot message yourself', 400);
      const { error } = await supabase.from('direct_messages').insert({
        sender_id: user.id,
        receiver_id: receiverId,
        content: content.trim(),
      });
      if (error) throw new APIError(error.message, 500);
    },

    async list(peerId, limit = 50) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, sender_id, receiver_id, content, msg_type, is_read, created_at')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw new APIError(error.message, 500);
      return data ?? [];
    },

    async conversations() {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      // Get all DMs involving the user, ordered by most recent
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, sender_id, receiver_id, content, created_at, is_read')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new APIError(error.message, 500);
      if (!data || !data.length) return [];
      // Group by conversation partner
      const convMap = {};
      for (const msg of data) {
        const peerId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
        if (!convMap[peerId]) {
          convMap[peerId] = { peerId, lastMessage: msg.content, lastAt: msg.created_at, unread: 0 };
        }
        if (!msg.is_read && msg.receiver_id === user.id) convMap[peerId].unread++;
      }
      // Fetch peer names
      const peerIds = Object.keys(convMap);
      if (peerIds.length) {
        const { data: peers } = await supabase.from('users')
          .select('id, name, avatar_color').in('id', peerIds);
        if (peers) peers.forEach(p => {
          if (convMap[p.id]) { convMap[p.id].name = p.name; convMap[p.id].color = p.avatar_color; }
        });
      }
      return Object.values(convMap).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    },

    subscribe(peerId, onMessage) {
      const supabase = getSupabase();
      const userId = localStorage.getItem('vs_user_id');
      return supabase
        .channel(`dm:${[userId, peerId].sort().join('-')}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'direct_messages',
          filter: `receiver_id=eq.${userId}`,
        }, (payload) => {
          if (payload.new.sender_id === peerId) onMessage(payload.new);
        })
        .subscribe();
    },

    unsubscribe(channel) {
      if (channel) getSupabase().removeChannel(channel);
    },

    async markRead(peerId) {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) return;
      await supabase.from('direct_messages')
        .update({ is_read: true })
        .eq('sender_id', peerId)
        .eq('receiver_id', user.id)
        .eq('is_read', false);
    },
  },

  // ──────────────────────────────────────────────────────────
  // CHAT (Realtime — booking-scoped)
  // ──────────────────────────────────────────────────────────
  chat: {
    async send(bookingId, content, msgType = 'text') {
      const supabase = getSupabase();
      const user = await VS.auth.getUser();
      if (!user) throw new APIError('Not authenticated', 401);
      const { error } = await supabase.from('chat_messages').insert({
        booking_id: bookingId,
        sender_id: user.id,
        content,
        msg_type: msgType,
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
    const sb = getSupabase();
    return sb
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

  // ─── VS.api compatibility helpers ───────────────────────────
  // These are called by 05/06/07/10/14 pages. They delegate to
  // the real VS.* namespaces so both demo mode and live mode work.
  api: {
    async getTeacher(id) {
      if (!id) return null;
      // Try teachers.get first (single user+skills query)
      try {
        const sb = getSupabase();
        const { data, error } = await sb
          .from('users')
          .select('id,name,college,avatar_color,bio,xp,level,last_active_at,skills(*)')
          .eq('id', id)
          .eq('is_banned', false)
          .single();
        if (error || !data) throw new Error('not found');
        const primarySkill = (data.skills || []).find(s => s.is_teaching) || data.skills?.[0] || {};
        const name = data.name || 'Unknown';
        return {
          id: data.id,
          name,
          initials: name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
          color: data.avatar_color || '#5B45E0',
          college: data.college || 'Verified Student',
          bio: data.bio || '',
          xp: data.xp || 0,
          level: data.level || 1,
          rating: 4.8,
          reviews: 0,
          reviews_count: 0,
          sessions: 0,
          completion_rate: 100,
          online: false,
          tier: primarySkill.tier || 'bronze',
          teaches: (data.skills || []).filter(s => s.is_teaching).map(s => s.name),
          wants: [],
          rate: primarySkill.coin_rate || 1.0,
          category: primarySkill.category || 'other',
        };
      } catch (e) {
        // Fall back to teachers list
        const list = await VS.teachers.getAll().catch(() => []);
        return list.find(t => t.id === id) || null;
      }
    },

    async getCurrentUser() {
      try {
        const sb = getSupabase();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return VS.auth.currentUser();
        const { data: profile } = await sb.from('users')
          .select('*').eq('id', user.id).single();
        if (!profile) return VS.auth.currentUser();
        const name = profile.name || user.email.split('@')[0];
        const coins = parseInt(localStorage.getItem('vs_coins') || '0');
        return {
          id: profile.id,
          name,
          initials: name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
          email: user.email,
          coins,
          xp: profile.xp || 0,
          level: profile.level || 1,
          college: profile.college || '',
          avatar_color: profile.avatar_color || '#5B45E0',
          game_progress: profile.game_progress || {},
        };
      } catch (e) {
        return VS.auth.currentUser();
      }
    },
  },





  mcqs: {
    async list(skillName) {
      const sb = getSupabase();
      const { data, error } = await sb.rpc('get_mcq_questions', {
        p_skill_name: skillName
      });
      if (error) throw new APIError('Failed to load questions.', 400);
      return data.map(q => ({
        id: q.id,
        q: q.question,
        opts: [q.option_a, q.option_b, q.option_c, q.option_d]
      }));
    },
    async verify(skillName, answersPayload, timeTakenS) {
      const sb = getSupabase();
      const { data, error } = await sb.rpc('verify_mcq_answers', {
        p_skill_name: skillName,
        p_answers: answersPayload,
        p_time_taken_s: timeTakenS
      });
      if (error) throw new APIError('Verification failed: ' + error.message, 400);
      return data;
    }
  },


  // ──────────────────────────────────────────────────────────
  // CAMPUS COLLAB (IRL Connect)
  // ──────────────────────────────────────────────────────────
  campus: {
    async list() {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('campus_requests')
        .select(`
          id, title, description, location_hint, treat_type, status, created_at,
          creator:creator_id(id, name, avatar_color)
        `)
        .eq('status', 'open')
        .order('created_at', { ascending: false });
      if (error) throw new APIError(error.message, 500);
      return data;
    },
    async post({ title, description, location_hint, treat_type, error_snippet }) {
      const sb = getSupabase();
      const user = VS.auth.currentUser();
      const { data: profile, error: pErr } = await sb.from('users').select('college').eq('id', user.id).single();
      if (pErr) throw new APIError('Failed to fetch college constraint', 500);

      const { data, error } = await sb
        .from('campus_requests')
        .insert({
          creator_id: user.id,
          college_id: profile?.college || 'Unknown College',
          title, description, location_hint, treat_type, error_snippet
        })
        .select()
        .single();
      if (error) throw new APIError(error.message, 500);
      return data;
    },
    async accept(requestId) {
      const sb = getSupabase();
      const user = VS.auth.currentUser();
      const { data, error } = await sb
        .from('campus_requests')
        .update({ status: 'accepted', helper_id: user.id })
        .eq('id', requestId)
        .select('id, creator_id, title')
        .single();
      if (error) throw new APIError(error.message, 500);
      return data;
    }
  },

  // ──────────────────────────────────────────────────────────
  // UI MANAGEMENT
  // ──────────────────────────────────────────────────────────
  ui: {
    async updateSidebar() {
      // 1. Start with fast cached data
      let name = localStorage.getItem('vs_user_name') || 'User';
      let coins = localStorage.getItem('vs_coins') || '0';
      let xp = localStorage.getItem('vs_user_xp') || '0';
      let level = localStorage.getItem('vs_user_level') || '1';
      let initials = name !== 'User' ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'U';

      // Immediate UI update from cache
      this._applySidebarUI(name, initials, coins, xp, level);

      // 2. Refresh with live data in background
      try {
        const user = VS.auth.currentUser();
        if (user) {
          const profile = await VS.profile.get();
          if (profile && profile.name) {
            name = profile.name;
            coins = String(profile.coins || 0);
            xp = String(profile.xp || 0);
            level = String(profile.level || 1);
            initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            // Re-apply with fresh data
            this._applySidebarUI(name, initials, coins, xp, level);
          }
        }
      } catch (err) {
        console.warn('Sidebar background sync failed:', err);
      }
    },

    _applySidebarUI(name, initials, coins, xp, level) {

      // Update Sidebar User Info
      document.querySelectorAll('.sb-avatar, .xph-avatar, .user-menu .avatar').forEach(el => el.textContent = initials);
      document.querySelectorAll('.sb-name, .xph-name, .user-menu .uname').forEach(el => el.textContent = name);

      const coinCount = document.getElementById('sb-coin-count') || document.getElementById('coin-count');
      if (coinCount) coinCount.textContent = coins;

      const sbCoin = document.querySelector('.sb-coin');
      if (sbCoin && !coinCount) sbCoin.innerHTML = `🪙 ${coins} coins`;

      // Update XP/Level if elements exist (e.g. in Quests page)
      const lvEl = document.querySelector('.xph-level');
      if (lvEl) lvEl.textContent = `Level ${level} · Skill Seeker`;

      const nameEl = document.querySelector('.xph-name');
      if (nameEl) nameEl.textContent = name;

      const xpEl = document.querySelector('.xph-xp');
      if (xpEl) {
        const xpNum = parseInt(xp) || 0;
        const nextXp = Math.ceil(xpNum / 500) * 500 || 500;
        xpEl.textContent = `${xpNum} / ${nextXp} XP to Level ${Math.floor(xpNum / 500) + 1}`;
        const bar = document.querySelector('.xph-fill');
        if (bar) bar.style.width = ((xpNum % 500) / 500 * 100) + '%';
      }

      // Update Nav Badges
      this.updateBadges();
    },

    async updateBadges() {
      const sb = getSupabase();
      const user = VS.auth.currentUser();

      // 1. Bounty Hub Badge (Open bounties)
      const { count: bCount } = await sb.from('bounties').select('id', { count: 'exact', head: true }).eq('status', 'open');
      document.querySelectorAll('a[href="09_bounty.html"] .badge, a[href="09_bounty.html"] .bdg').forEach(el => el.textContent = bCount || 0);

      // 2. My Sessions Badge (Upcoming sessions)
      if (user) {
        const { count: sCount } = await sb.from('bookings').select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'confirmed', 'active'])
          .or(`learner_id.eq.${user.id},teacher_id.eq.${user.id}`);
        document.querySelectorAll('a[href="11_my_sessions.html"] .badge, a[href="11_my_sessions.html"] .bdg').forEach(el => el.textContent = sCount || 0);

        // 3. Campus Collab Badge (Open requests in same college)
        const profile = await VS.profile.get();
        if (profile && profile.college_id) {
          const { count: cCount } = await sb.from('campus_requests').select('id', { count: 'exact', head: true })
            .eq('status', 'open')
            .eq('college_id', profile.college_id);
          document.querySelectorAll('a[href="15_campus_collab.html"] .badge, #sb-campus-badge').forEach(el => el.textContent = cCount || 0);
        }

        // 4. Messages Badge (Unread DMs)
        const { count: dmCount } = await sb.from('direct_messages').select('id', { count: 'exact', head: true })
          .eq('receiver_id', user.id)
          .eq('is_read', false);
        document.querySelectorAll('a[href="16_messages.html"] .badge, #sb-unread-count, #sb-unread-count-top').forEach(el => {
          el.textContent = dmCount || 0;
          el.style.display = dmCount > 0 ? 'block' : 'none';
        });
      }
    }
  }
};
// Auto-update UI on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.VS && window.VS.ui) {
      window.VS.ui.updateSidebar();
    }
  });
}
