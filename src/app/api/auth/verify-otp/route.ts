import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scryptSync, timingSafeEqual } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/auth/verify-otp
 * Body: { code: string }
 *
 * Verifies the OTP code entered by the student.
 *
 * New flow (v74 — Bot API):
 *   - The student has clicked Start in Telegram, which triggered the
 *     webhook to generate + send the OTP via Bot API.
 *   - The OTP hash + chat_id are stored in the otp_codes row with
 *     status='otp_sent'.
 *   - This endpoint looks up the latest status='otp_sent' session,
 *     verifies the OTP, and on success transitions status='verified'
 *     + phone_verified=true + account_status='pending'.
 *
 * Security:
 *   - OTP is hashed with scrypt (never stored in plaintext).
 *   - Constant-time comparison (timingSafeEqual).
 *   - Max 5 attempts per session — then status='expired'.
 *   - Expired OTPs are rejected.
 *   - Used sessions are rejected (status='verified' → can't verify again).
 *   - Same response shape for all errors (no enumeration).
 */
const BodySchema = z.object({ code: z.string().trim().length(6) });

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'الكود غير صالح' }, { status: 400 });
  }

  // 1. Fetch user profile
  const { data: profile } = await supabaseServer
    .from('users')
    .select('id, account_status, phone, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف الشخصي غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; account_status: string; phone: string | null; phone_verified: boolean };

  // 2. Resilient OTP gate
  const needsOtp =
    p.account_status === 'pending_verification' ||
    (p.account_status === 'pending' && !!p.phone && p.phone_verified === false);

  if (!needsOtp) {
    return NextResponse.json({ success: false, error: 'حسابك لا يحتاج إلى التحقق من الهاتف' }, { status: 400 });
  }

  // 3. Find the latest otp_sent session for this user
  const { data: session } = await supabaseServer
    .from('otp_codes')
    .select('id, code_hash, code_salt, expires_at, attempts, max_attempts, status')
    .eq('user_id', p.id)
    .eq('status', 'otp_sent')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد كود تحقق نشط. افتح Telegram واضغط Start أولاً.' },
      { status: 404 }
    );
  }

  const s = session as {
    id: string;
    code_hash: string | null;
    code_salt: string | null;
    expires_at: string | null;
    attempts: number;
    max_attempts: number;
    status: string;
  };

  // 4. Check expiry
  if (!s.expires_at || new Date(s.expires_at) <= new Date()) {
    await supabaseServer
      .from('otp_codes')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', s.id);
    return NextResponse.json(
      { success: false, error: 'انتهت صلاحية الكود. اطلب كوداً جديداً.' },
      { status: 410 }
    );
  }

  // 5. Check attempt limit
  if (s.attempts >= s.max_attempts) {
    await supabaseServer
      .from('otp_codes')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', s.id);
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد الأقصى من المحاولات. اطلب كوداً جديداً.' },
      { status: 429 }
    );
  }

  // 6. Increment attempts (race-condition prevention)
  await supabaseServer
    .from('otp_codes')
    .update({ attempts: s.attempts + 1, updated_at: new Date().toISOString() })
    .eq('id', s.id);

  // 7. Verify OTP hash (constant-time)
  if (!s.code_hash || !s.code_salt) {
    return NextResponse.json({ success: false, error: 'الكود غير متاح' }, { status: 400 });
  }
  const expectedHash = Buffer.from(s.code_hash, 'hex');
  const actualHash = scryptSync(parsed.data.code, s.code_salt, 64);
  const isMatch = expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);

  if (!isMatch) {
    return NextResponse.json({ success: false, error: 'الكود غير صحيح' }, { status: 400 });
  }

  // 8. Success — atomic transition status='otp_sent' → 'verified'
  //    (prevents double-verification)
  const { data: claimed } = await supabaseServer
    .from('otp_codes')
    .update({
      status: 'verified',
      used: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', s.id)
    .eq('status', 'otp_sent') // conditional — only if still otp_sent
    .select('id')
    .maybeSingle();

  if (!claimed) {
    // Race condition — another verify call already processed this
    return NextResponse.json(
      { success: false, error: 'تم التحقق من هذا الكود بالفعل.' },
      { status: 409 }
    );
  }

  // 9. Mark phone as verified + transition account_status → 'pending'
  //    (so the activation page can take over)
  await supabaseServer
    .from('users')
    .update({
      phone_verified: true,
      account_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', p.id);

  return NextResponse.json({
    success: true,
    message: 'تم التحقق من رقم هاتفك بنجاح. يمكنك الآن تفعيل حسابك.',
  });
}
