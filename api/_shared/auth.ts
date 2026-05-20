// api/_shared/auth.ts
// Authentication guard — extracts and verifies JWT from the Authorization header.

import { adminClient } from './supabase';



export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Extracts the JWT from the Authorization header and verifies it.
 * Returns the authenticated user or throws AuthError.
 */
export async function requireAuth(req: Request): Promise<{ id: string; email: string }> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) throw new AuthError('Missing authorization token');

  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) throw new AuthError('Invalid or expired token');
  if (!data.user.email) throw new AuthError('User has no email');

  return { id: data.user.id, email: data.user.email };
}
