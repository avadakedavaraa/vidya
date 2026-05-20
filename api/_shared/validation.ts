export function sanitizeText(input: unknown, maxLen = 500): string {
  if (typeof input !== "string") {
    return "";
  }

  return input.trim().slice(0, maxLen).replace(/[<>]/g, "");
}

export function validateEmail(email: unknown): boolean {
  if (typeof email !== "string") {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validateUUID(id: unknown): boolean {
  if (typeof id !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}
