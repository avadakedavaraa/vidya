export function getSupabase() {
  if (window.__supabaseClient) {
    return window.__supabaseClient;
  }

  const { createClient } = window.supabase;

  window.__supabaseClient = createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    },
  );

  return window.__supabaseClient;
}

export class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

async function getAuthHeaders(requireAuth) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (!requireAuth) {
    return headers;
  }

  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    const redirect = encodeURIComponent(
      window.location.pathname + window.location.search,
    );

    window.location.href = `02_login.html?redirect=${redirect}`;
    return null;
  }

  headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

function getApiErrorMessage(status, data) {
  if (data?.error) {
    return data.error;
  }

  if (status === 404) {
    return "API route not found. Start the app with `npx vercel dev` so /api functions are available.";
  }

  return "Request failed";
}

export async function edgeFn(endpoint, payload = {}, requireAuth = true) {
  const headers = await getAuthHeaders(requireAuth);

  if (!headers) {
    return null;
  }

  try {
    const response = await fetch(`/api/${endpoint}`, {
      body: JSON.stringify(payload),
      headers,
      method: "POST",
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : null;

    if (!response.ok) {
      throw new APIError(
        getApiErrorMessage(response.status, data),
        response.status,
      );
    }

    return data;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    throw new APIError("Network error. Check your connection.", 0);
  }
}
