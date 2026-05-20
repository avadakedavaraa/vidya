export async function hashOtp(email: string, otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const input = encoder.encode(`${otp}${email}`);
  const digest = await crypto.subtle.digest("SHA-256", input);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
