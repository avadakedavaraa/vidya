// api/_shared/supabase.ts
// Supabase client initialization — Admin (SERVICE_ROLE) and User (ANON + JWT).

import { createClient } from '@supabase/supabase-js';

/**
 * Admin client — bypasses RLS for server-side operations.
 * Uses SERVICE_ROLE key. NEVER expose this key to the client.
 */
export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User client — respects RLS by forwarding the user's JWT.
 */
export function userClient(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
