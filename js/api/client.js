/**
 * js/api/client.js — Supabase singleton, edge function wrapper, and APIError.
 * This is the foundation all other frontend API modules depend on.
 */

// ─── Supabase client (singleton) ─────────────────────────────
let _supabase = null;
export function getSupabase() {
  if (!_supabase) {
    const { createClient } = window.supabase;
    _supabase = createClient(
      window.APP_CONFIG.SUPABASE_URL,
      window.APP_CONFIG.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        }
      }
    );
  }
  return _supabase;
}

// ─── API Error class ─────────────────────────────────────────
export class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

// ─── Core fetch wrapper (authenticated) ──────────────────────
export async function edgeFn(endpoint, payload = {}, requireAuth = true) {
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
    const url = `${window.APP_CONFIG.SUPABASE_URL}/functions/v1/${endpoint}`;
    const res = await fetch(
      url,
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
