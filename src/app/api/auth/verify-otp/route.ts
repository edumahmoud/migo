import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scryptSync, timingSafeEqual } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/auth/verify-otp
 * Body: { code: string }
 *
 * Verifies the OTP code entered by the student. The student must be
 * authenticated and have account_status='pending_verification'.
 *
 * Security:
 *   - OTP is hashed with scrypt (never stored in plaintext).
 *   - Max 5 attempts per OTP code — then the code is invalidated.
 *   - Expired codes are rejected.
 *   - Used codes are rejected (no reuse).
 *   - Brute force: after 5 failed attempts, the code is marked used.
 *   - Account enumeration: same response shape for all errors.
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

  // 1. Fetch the student's profile.
  const { data: profile } = await supabaseServer
    .from('users')
    .select('id, account_status, phone, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف الشخصي غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; account_status: string; phone: string | null; phone_verified: boolean };

  // 2. Resilient OTP gate.
  //    - 'pending_verification' is the v73 status (preferred path).
  //    - 'pending' + phone set + phone_verified=false is the degraded
  //      state when v73 migration wasn't applied (v68 trigger set
  //      'pending' instead). We still let the user verify their phone
  //      so they can complete registration.
  //    - 'active' / 'suspended' / phone already verified → reject.
  const needsOtp =
    p.account_status === 'pending_verification' ||
    (p.account_status === 'pending' && !!p.phone && p.phone_verified === false);

  if (!needsOtp) {
    return NextResponse.json({ success: false, error: 'حسابك لا يحتاج إلى التحقق من الهاتف' }, { status: 400 });
  }

  // 3. Fetch the latest unused, non-expired OTP for this user.
  const { data: otpRow } = await supabaseServer
    .from('otp_codes')
    .select('id, code_hash, code_salt, expires_at, attempts, max_attempts, used')
    .eq('user_id', p.id)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otpRow) {
    return NextResponse.json({ success: false, error: 'لا يوجد كود تحقق نشط. اطلب إعادة الإرسال.' }, { status: 404 });
  }

  const otp = otpRow as { id: string; code_hash: string; code_salt: string; expires_at: string; attempts: number; max_attempts: number; used: boolean };

  // 4. Check expiry.
  if (new Date(otp.expires_at) <= new Date()) {
    await supabaseServer.from('otp_codes').update({ used: true }).eq('id', otp.id);
    return NextResponse.json({ success: false, error: 'انتهت صلاحية الكود. اطلب كوداً جديداً.' }, { status: 410 });
  }

  // 5. Check attempt limit.
  if (otp.attempts >= otp.max_attempts) {
    await supabaseServer.from('otp_codes').update({ used: true }).eq('id', otp.id);
    return NextResponse.json({ success: false, error: 'تجاوزت الحد الأقصى من المحاولات. اطلب كوداً جديداً.' }, { status: 429 });
  }

  // 6. Increment attempts BEFORE verification (prevent race condition).
  await supabaseServer
    .from('otp_codes')
    .update({ attempts: otp.attempts + 1 })
    .eq('id', otp.id);

  // 7. Verify the code (constant-time comparison).
  const expectedHash = Buffer.from(otp.code_hash, 'hex');
  const actualHash = scryptSync(parsed.data.code, otp.code_salt, 64);
  const isMatch = expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);

  if (!isMatch) {
    // Don't reveal whether the code exists or is just wrong.
    return NextResponse.json({ success: false, error: 'الكود غير صحيح' }, { status: 400 });
  }

  // 8. Success — mark OTP as used, verify phone, activate to 'pending'.
  await supabaseServer
    .from('otp_codes')
    .update({ used: true })
    .eq('id', otp.id);

  // Resilient transition:
  //   - If user was 'pending_verification' (v73 path) → transition to 'pending'.
  //   - If user was already 'pending' (degraded path) → keep 'pending'.
  //   Either way, phone_verified=true is the authoritative signal that
  //   the OTP step is complete; the activation page takes over from there.
  await supabaseServer
    .from('users')
    .update({
      phone_verified: true,
      account_status: 'pending', // Transition to payment-pending state.
      updated_at: new Date().toISOString(),
    })
    .eq('id', p.id);

  return NextResponse.json({
    success: true,
    message: 'تم التحقق من رقم الهاتف بنجاح. يمكنك الآن تفعيل حسابك.',
  });
}
