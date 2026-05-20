export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "*";

  return {
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "86400",
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: getCorsHeaders(req),
      status: 204,
    });
  }

  return null;
}

export function ok(data: unknown, req: Request, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(req),
    },
    status,
  });
}

export function err(message: string, req: Request, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(req),
    },
    status,
  });
}
