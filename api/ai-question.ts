// api/ai-question.ts
// Secure proxy for NVIDIA AI question generation.
// The NVIDIA_API_KEY stays on the server — never exposed to the browser.

import { handleOptions, ok, err } from './_shared/responses';
import { requireAuth, AuthError } from './_shared/auth';

export const config = { runtime: 'edge' };

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL    = 'minimaxai/minimax-m2.7';

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  // Auth required — only logged-in users can generate AI questions
  let user: { id: string; email: string };
  try {
    user = await requireAuth(req);
  } catch (e) {
    return err(e instanceof AuthError ? e.message : 'Unauthorized', req, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  const prompt = body.prompt as string;
  if (!prompt || typeof prompt !== 'string' || prompt.length < 10) {
    return err('prompt is required', req, 400);
  }
  if (prompt.length > 4000) {
    return err('prompt too long (max 4000 chars)', req, 400);
  }

  const apiKey = process.env['NVIDIA_API_KEY'];
  if (!apiKey) {
    return err('AI service not configured', req, 503);
  }

  // ─── Call NVIDIA API (non-streaming — collect full response) ──
  try {
    const nvidiaRes = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       NVIDIA_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 1,
        top_p:       0.95,
        max_tokens:  1024,
        stream:      false, // Keep it simple for question generation
      }),
    });

    if (!nvidiaRes.ok) {
      const detail = await nvidiaRes.text();
      console.error('NVIDIA API error:', detail);
      return err('AI service unavailable. Falling back to database.', req, 502);
    }

    const data = await nvidiaRes.json();
    const text = data?.choices?.[0]?.message?.content ?? '';

    if (!text) return err('AI returned empty response', req, 502);

    // Return just the raw text — parsing happens client-side
    return ok({ text }, req);

  } catch (fetchErr) {
    console.error('NVIDIA fetch failed:', fetchErr);
    return err('Failed to reach AI service', req, 503);
  }
}
