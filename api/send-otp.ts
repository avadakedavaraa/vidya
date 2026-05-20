import { rateLimit } from "./_shared/ledger";
import { hashOtp } from "./_shared/otp";
import { handleOptions, ok, err } from "./_shared/responses";
import { adminClient, getEnv } from "./_shared/supabase";
import { sanitizeText, validateEmail } from "./_shared/validation";

const FROM_EMAIL = "noreply@vidyasetu.in";

export const config = { runtime: "edge" };

export default async function (req: Request) {
  const preflight = handleOptions(req);

  if (preflight) return preflight;
  if (req.method !== "POST") return err("Method not allowed", req, 405);

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", req, 400);
  }

  const email = sanitizeText(body.email, 254).toLowerCase();
  const purpose = body.purpose as string;

  if (!validateEmail(email)) return err("Invalid email address", req, 400);
  if (!["signup", "login", "reset_password"].includes(purpose)) {
    return err("Invalid purpose", req, 400);
  }

  const limited = await rateLimit(`otp:${email}`, "send_otp", 5, 900);

  if (limited) {
    return err("Too many OTP requests. Please wait 15 minutes.", req, 429);
  }

  const resendApiKey = getEnv("RESEND_API_KEY");

  if (!resendApiKey) {
    return err("Email service is not configured.", req, 503);
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const hashHex = await hashOtp(email, otp);
  const db = adminClient();

  await db
    .from("otp_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("email", email)
    .eq("purpose", purpose)
    .is("used_at", null);

  const { error: insertError } = await db
    .from("otp_tokens")
    .insert({ email, purpose, token_hash: hashHex });

  if (insertError) {
    return err("Could not generate OTP. Try again.", req, 500);
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from: FROM_EMAIL,
      html: buildEmailHTML(otp, purpose),
      subject: getSubject(purpose),
      to: [email],
    }),
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!resendResponse.ok) {
    return err("Email delivery failed. Check your email address.", req, 500);
  }

  return ok({ message: `OTP sent to ${email}`, success: true }, req);
}

function getSubject(purpose: string): string {
  const subjects: Record<string, string> = {
    login: "Your Vidyasetu login code",
    reset_password: "Reset your Vidyasetu password",
    signup: "Your Vidyasetu verification code",
  };

  return subjects[purpose] ?? "Your Vidyasetu code";
}

function buildEmailHTML(otp: string, purpose: string): string {
  const actionText =
    purpose === "signup"
      ? "complete your registration"
      : purpose === "login"
        ? "sign in to your account"
        : "reset your password";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'DM Sans',Arial,sans-serif;background:#F7F8FA;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;border:1px solid #E5E7EB">
    <div style="text-align:center;margin-bottom:32px"><span style="font-size:2rem">🌉</span>
      <h1 style="font-family:serif;font-size:1.6rem;color:#0D0D1A;margin:8px 0 0">Vidyasetu</h1></div>
    <p style="color:#4B5563;font-size:1rem;line-height:1.6;margin-bottom:24px">Use the code below to ${actionText}. It expires in <strong>10 minutes</strong>.</p>
    <div style="background:#F0EEF9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
      <span style="font-family:'JetBrains Mono',monospace;font-size:2.5rem;font-weight:700;letter-spacing:0.3em;color:#5B45E0">${otp}</span></div>
    <p style="color:#9CA3AF;font-size:0.85rem;line-height:1.6;margin:0">If you didn't request this, you can safely ignore this email.<br>Never share this code with anyone — Vidyasetu will never ask for it.</p>
  </div></body></html>`;
}
