import bcrypt from 'bcryptjs';

/**
 * Password hashing utility for admin destructive-action password.
 *
 * Uses bcryptjs (pure JS, no native build) with a cost factor of 12.
 * The hash is stored in the admin_security table (RLS-protected,
 * service-role-only access).
 *
 * This is SEPARATE from the user's Supabase Auth login password —
 * the destructive-action password is an additional secret that must
 * be provided before any data-wiping operation.
 */

const SALT_ROUNDS = 12;

/** Hash a plaintext password. Returns a bcrypt hash string. */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plaintext, salt);
}

/** Verify a plaintext password against a bcrypt hash. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/** Minimum requirements for the destructive-action password. */
export const DESTRUCT_PASSWORD_MIN_LENGTH = 8;

/** Validate that a password meets minimum strength requirements. */
export function validateDestructPassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < DESTRUCT_PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `كلمة المرور يجب أن تكون ${DESTRUCT_PASSWORD_MIN_LENGTH} أحرف على الأقل` };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'كلمة المرور يجب أن تحتوي على أحرف' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'كلمة المرور يجب أن تحتوي على أرقام' };
  }
  return { valid: true };
}
