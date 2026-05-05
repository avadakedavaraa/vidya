/**
 * js/api/auth.js — Authentication: login, signup, OTP, Google OAuth.
 */
import { getSupabase, APIError } from './client.js';

export const auth = {
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
    ['vs_logged_in', 'vs_user_id', 'vs_coins', 'vs_user_name',
      'vs_user_role', 'vs_user_level', 'vs_user_xp', 'vs_demo_mode'].forEach(k => localStorage.removeItem(k));
    const supabase = getSupabase();
    supabase.auth.signOut().finally(() => {
      localStorage.clear();
      window.location.href = 'index.html';
    });
  },

  signOut() { return this.logout(); },

  async requireLogin() {
    const loggedIn = localStorage.getItem('vs_logged_in') === 'true';
    if (!loggedIn) {
      const redirect = encodeURIComponent(window.location.pathname);
      window.location.href = `02_login.html?redirect=${redirect}`;
      return false;
    }
    return true;
  },

  isLoggedIn() { return localStorage.getItem('vs_logged_in') === 'true'; },

  currentUser() {
    const name = localStorage.getItem('vs_user_name') || 'User';
    const id = localStorage.getItem('vs_user_id');
    const email = '';
    const coins = parseInt(localStorage.getItem('vs_coins') || '0', 10);
    return id ? { id, name, email, coins } : null;
  },

  async loginWithPassword(email, password) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
    if (error) throw new APIError(error.message, error.status || 400);
    const user = data?.user;
    if (!user) throw new APIError('Login failed.', 400);
    const { data: profile } = await sb.from('users').select('name').eq('id', user.id).maybeSingle();
    localStorage.setItem('vs_logged_in', 'true');
    localStorage.setItem('vs_user_id', user.id);
    localStorage.setItem('vs_user_name', profile?.name ?? user.email.split('@')[0]);
    // Get real coin balance from ledger
    const { data: balance } = await sb.rpc('get_coin_balance');
    localStorage.setItem('vs_coins', String(Number(balance ?? 0)));
    return { success: true, id: user.id, name: profile?.name, coins: profile?.coins ?? 0 };
  },

  async signupWithPassword(email, password, extra = {}) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({ email: email.toLowerCase().trim(), password, options: { data: extra } });
    if (error) {
      if (error.message?.toLowerCase().includes('already registered'))
        throw new APIError('This email is already registered. Please sign in instead.', 409);
      throw new APIError(error.message || 'Signup failed.', error.status || 400);
    }
    return { success: true };
  },

  async verifyOTP(email, otp, purpose = 'signup', extra = {}) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.verifyOtp({ email: email.toLowerCase().trim(), token: otp.trim(), type: (purpose === 'signup' || purpose === 'login') ? 'signup' : 'recovery' });
    if (error) throw new APIError(error.message, error.status || 400);
    const user = data?.user;
    if (!user) throw new APIError('Verification failed.', 400);
    if (purpose === 'signup') {
      await sb.from('users').update({ name: extra.name || user.email.split('@')[0], role: extra.role || 'both' }).eq('id', user.id);
    }
    const { data: profile } = await sb.from('users').select('name, coins').eq('id', user.id).maybeSingle();
    localStorage.setItem('vs_logged_in', 'true');
    localStorage.setItem('vs_user_id', user.id);
    localStorage.setItem('vs_user_name', profile?.name ?? extra.name ?? user.email.split('@')[0]);
    localStorage.setItem('vs_coins', String(profile?.coins ?? 2));
    return { success: true, id: user.id, name: profile?.name, coins: profile?.coins ?? 2 };
  },

  async sendOTP(email, purpose = 'login') {
    const sb = getSupabase();
    if (purpose === 'reset_password') {
      const { error } = await sb.auth.resetPasswordForEmail(email.toLowerCase().trim());
      if (error) throw new APIError(error.message, error.status || 400);
    } else {
      const { error } = await sb.auth.signInWithOtp({ email: email.toLowerCase().trim(), options: { shouldCreateUser: purpose === 'signup' } });
      if (error) throw new APIError(error.message, error.status || 400);
    }
    return { success: true };
  },

  async updatePassword(newPassword) {
    const sb = getSupabase();
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw new APIError(error.message, error.status || 400);
    return { success: true };
  },

  async loginWithGoogle(redirectAfter = '03_dashboard.html') {
    const sb = getSupabase();
    let origin = window.location.origin;
    let callbackUrl = origin + '/02_login.html?auth_callback=1&redirect=' + encodeURIComponent(redirectAfter);
    if (!origin || origin === 'null' || origin === 'file://') {
      callbackUrl = window.APP_CONFIG.SUPABASE_URL + '/02_login.html?auth_callback=1&redirect=' + encodeURIComponent(redirectAfter);
    }
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl, queryParams: { access_type: 'offline', prompt: 'consent' }, skipBrowserRedirect: false } });
    if (error) throw new APIError(error.message, error.status || 400);
  },

  async handleOAuthCallback() {
    const sb = getSupabase();
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const hasCallback = params.get('auth_callback') === '1';
    const hasHashToken = hash.includes('access_token=');
    const hasHashError = hash.includes('error=');
    const { data: existingSession } = await sb.auth.getSession();
    const justLoggedIn = existingSession?.session && !localStorage.getItem('vs_logged_in') && existingSession.session.user?.app_metadata?.provider === 'google';
    if (!hasCallback && !hasHashToken && !hasHashError && !justLoggedIn) return;
    await new Promise(r => setTimeout(r, 100));
    const { data, error: sessionError } = await sb.auth.getSession();
    if (sessionError || !data?.session) {
      if (hasHashError) { const errMatch = hash.match(/error_description=([^&]+)/); if (errMatch) console.error('OAuth error:', decodeURIComponent(errMatch[1])); }
      return;
    }
    const user = data.session.user;
    const googleName = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
    await sb.from('users').upsert({ id: user.id, email: user.email, name: googleName, role: 'both', avatar_color: '#5B45E0' }, { onConflict: 'id' });
    await sb.from('coin_ledger').insert({ user_id: user.id, amount: 2, type: 'welcome_bonus', note: 'Welcome to Vidyasetu! 🎉' });
    const { data: profile } = await sb.from('users').select('name').eq('id', user.id).maybeSingle();
    const coinBalance = await sb.rpc('get_coin_balance', { p_user_id: user.id }).then(r => Number(r.data ?? 2)).catch(() => 2);
    localStorage.setItem('vs_logged_in', 'true');
    localStorage.setItem('vs_user_id', user.id);
    localStorage.setItem('vs_user_name', profile?.name ?? googleName);
    localStorage.setItem('vs_coins', String(coinBalance));
    if (window.history?.replaceState) window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    window.location.replace(params.get('redirect') || '03_dashboard.html');
  },
};
