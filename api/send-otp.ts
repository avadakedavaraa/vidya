// supabase/functions/send-otp/index.ts
// Generates a 6-digit OTP, stores the SHA-256 hash in DB, sends the email via Resend.
// Rate limited: 5 OTPs per email per 15 minutes.

import {
  handleOptions, ok, err,
  adminClient, rateLimit,
  validateEmail, sanitizeText
} from './_shared/utils';

const RESEND_API_KEY = process.env['RESEND_API_KEY']!;
const FROM_EMAIL     = 'noreply@vidyasetu.in';

export const config = { runtime: 'edge' };

export default async function (req: Request) {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return err('Method not allowed', req, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body', req, 400);
  }

  const email   = sanitizeText(body.email, 254).toLowerCase();
  const purpose = body.purpose as string;

  // ─── Input validation ─────────────────────────────────────
  if (!validateEmail(email)) return err('Invalid email address', req, 400);
  if (!['signup', 'login', 'reset_password'].includes(purpose)) {
    return err('Invalid purpose', req, 400);
  }

  // ─── Rate limit: 5 per email per 15 min ──────────────────
  const limited = await rateLimit(`otp:${email}`, 'send_otp', 5, 900);
  if (limited) {
    return err('Too many OTP requests. Please wait 15 minutes.', req, 429);
  }

  // ─── Generate OTP ─────────────────────────────────────────
  const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit

  // ─── Hash the OTP (SHA-256) — never store plain OTP ──────
  const encoder    = new TextEncoder();
  const data       = encoder.encode(otp + email); // salt with email
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex    = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // ─── Store in DB ──────────────────────────────────────────
  const db = adminClient();

  // Invalidate any existing unused OTPs for this email + purpose
  await db.from('otp_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('email', email)
    .eq('purpose', purpose)
    .is('used_at', null);

  const { error: insertErr } = await db.from('otp_tokens').insert({
    email,
    token_hash: hashHex,
    purpose,
  });
  if (insertErr) {
    console.error('OTP insert failed:', insertErr);
    return err('Could not generate OTP. Try again.', req, 500);
  }

  // ─── Send email via Resend ────────────────────────────────
  const emailBody = buildEmailHTML(otp, purpose);
  const resendRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [email],
      subject: getSubject(purpose),
      html:    emailBody,
    }),
  });

  if (!resendRes.ok) {
    const resendErr = await resendRes.text();
    console.error('Resend error:', resendErr);
    return err('Email delivery failed. Check your email address.', req, 500);
  }

  return ok({ success: true, message: `OTP sent to ${email}` }, req);
}

// ─── Random code generator ─────────────────────────────────────────────────
function getSubject(purpose: string): string {
  const subjects: Record<string, string> = {
    signup:         'Your Vidyasetu verification code',
    login:          'Your Vidyasetu login code',
    reset_password: 'Reset your Vidyasetu password',
  };
  return subjects[purpose] ?? 'Your Vidyasetu code';
}

function buildEmailHTML(otp: string, purpose: string): string {
  const actionText = purpose === 'signup' ? 'complete your registration' :
                     purpose === 'login'  ? 'sign in to your account'   :
                     'reset your password';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;background:#F7F8FA;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;border:1px solid #E5E7EB">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-size:2rem">🌉</span>
      <h1 style="font-family:serif;font-size:1.6rem;color:#0D0D1A;margin:8px 0 0">Vidyasetu</h1>
    </div>
    <p style="color:#4B5563;font-size:1rem;line-height:1.6;margin-bottom:24px">
      Use the code below to ${actionText}. It expires in <strong>10 minutes</strong>.
    </p>
    <div style="background:#F0EEF9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
      <span style="font-family:'JetBrains Mono',monospace;font-size:2.5rem;font-weight:700;
                   letter-spacing:0.3em;color:#5B45E0">${otp}</span>
    </div>
    <p style="color:#9CA3AF;font-size:0.85rem;line-height:1.6;margin:0">
      If you didn't request this, you can safely ignore this email.<br>
      Never share this code with anyone — Vidyasetu will never ask for it.
    </p>
  </div>
</body>
</html>`;
}
