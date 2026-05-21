import { createClient } from "@supabase/supabase-js";

export function getEnv(key: string): string | undefined {
  const globalObject = globalThis as any;

  try {
    if (globalObject.Deno?.env) {
      return globalObject.Deno.env.get(key);
    }
  } catch {}

  try {
    if (globalObject.process?.env) {
      return globalObject.process.env[key];
    }
  } catch {}

  return undefined;
}

function requireEnv(key: string): string {
  const value = getEnv(key);

  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

function createServerClient(key: string, options = {}) {
  return createClient(requireEnv("SUPABASE_URL"), key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...options,
  });
}

export function adminClient() {
  return createServerClient(requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export function userClient(req: Request) {
  return createServerClient(requireEnv("SUPABASE_ANON_KEY"), {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") ?? "",
      },
    },
  });
}
