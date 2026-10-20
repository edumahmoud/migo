import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { verifyPassword } from '@/lib/admin-security';

/**
 * POST /api/admin/destruct/verify
 *
 * Verifies the destructive-action password. Returns a short-lived
 * verification token that the client includes in subsequent preview/
 * execute requests.
 *
 * Body: { password: string }
 *
 * Response: { success: true, token: string, expiresAt: string }
 *
 * The token is a signed JWT-like string (HMAC of userId + expiry).
 * It expires after 10 minutes. The execute endpoint re-verifies the
 * token AND requires the password again (defense in depth).
 */

// Token TTL: 10 minutes.
const TOKEN_TTL_MS = 10 * 60 * 1000;

function getTokenSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-not-secure';
}

function signToken(userId: string, expiresAt: number): string {
  // Simple HMAC using Node's crypto. The secret is the service role key
  // (already available in the environment, not exposed to the client).
  const secret = getTokenSecret();
  const payload = `${userId}|${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64');
}

export function verifyToken(token: string, userId: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split('|');
    if (parts.length !== 3) return false;
    const [tokenUserId, expiresAtStr, sig] = parts;
    if (tokenUserId !== userId) return false;
    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt)) return false;
    if (Date.now() > expiresAt) return false;
    // Re-compute signature.
    const secret = getTokenSecret();
    const payload = `${tokenUserId}|${expiresAtStr}`;
    const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
    if (sig !== expectedSig) return false;
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { password } = body as { password?: string };
  if (!password) {
    return NextResponse.json({ error: 'كلمة المرور مطلوبة' }, { status: 400 });
  }

  // Fetch the stored hash.
  const { data: securityRow } = await supabaseServer
    .from('admin_security')
    .select('destruct_password_hash')
    .maybeSingle();

  if (!securityRow?.destruct_password_hash) {
    return NextResponse.json({ error: 'لم يتم تعيين كلمة مرور الحذف بعد' }, { status: 400 });
  }

  const valid = await verifyPassword(password, securityRow.destruct_password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 });
  }

  // Issue a short-lived token.
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const token = signToken(auth.user.id, expiresAt);

  return NextResponse.json({
    success: true,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
  });
}
