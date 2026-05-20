// api/_shared/supabase.ts
// Supabase client initialization — Admin (SERVICE_ROLE) and User (ANON + JWT).

import { createClient } from '@supabase/supabase-js';

/**
 * Admin client — bypasses RLS for server-side operations.
 * Uses SERVICE_ROLE key. NEVER expose this key to the client.
 */
/**
 * Environment-agnostic helper to get configuration values.
 * Supports Deno (Supabase Edge Functions) and Node.js (Vercel).
 */
export function getEnv(key: string): string | undefined {



  // Access global context safely across Deno and Node.js
  const g = globalThis as any;
  
  try {
    if (g.Deno && g.Deno.env) return g.Deno.env.get(key);
  } catch {}
  
  try {
    if (g.process && g.process.env) return g.process.env[key];
  } catch {}
  
  return undefined;
}


/**
 * Admin client — bypasses RLS for server-side operations.
 * Uses SERVICE_ROLE key. NEVER expose this key to the client.
 */
export function adminClient() {
  const url = getEnv('SUPABASE_URL')!;
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User client — respects RLS by forwarding the user's JWT.
 */
export function userClient(req: Request) {
  const url = getEnv('SUPABASE_URL')!;
  const anonKey = getEnv('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

