import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { normalizePhoneToE164, isValidE164 } from '@/lib/phone-utils';

/**
 * POST /api/auth/update-phone
 *
 * Lets a student who is stuck on the OTP page (because they entered
 * their phone in local format like 01555614624 instead of +201555614624)
 * update their stored phone number. The new number is NORMALIZED to
 * E.164 before storage so Telegram Gateway accepts it.
 *
 * Only allowed when:
 *   - User is authenticated
 *   - account_status is 'pending' or 'pending_verification' (not yet active)
 *   - phone_verified is false (can't change a verified phone here)
 *
 * Body: { phone: string }   (any reasonable format — will be normalized)
 *
 * Returns the updated profile.
 */
const BodySchema = z.object({
  phone: z.string().trim().min(8).max(20),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'رقم الهاتف غير صالح' }, { status: 400 });
  }

  // Normalize to E.164
  const normalizedPhone = normalizePhoneToE164(parsed.data.phone);
  if (!normalizedPhone || !isValidE164(normalizedPhone)) {
    return NextResponse.json(
      { success: false, error: 'تعذّر تحويل الرقم إلى صيغة دولية. مثال صحيح: +201555614624' },
      { status: 400 }
    );
  }

  // Fetch the current profile
  const { data: profile, error: profileErr } = await supabaseServer
    .from('users')
    .select('id, account_status, phone, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (profileErr) {
    return NextResponse.json({ success: false, error: profileErr.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف الشخصي غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; account_status: string; phone: string | null; phone_verified: boolean };

  // Guard: only pending students can update their phone
  if (p.phone_verified === true) {
    return NextResponse.json(
      { success: false, error: 'لا يمكن تغيير رقم هاتف متحقق منه. تواصل مع الدعم.' },
      { status: 400 }
    );
  }
  if (p.account_status !== 'pending' && p.account_status !== 'pending_verification') {
    return NextResponse.json(
      { success: false, error: `حالة الحساب (${p.account_status}) لا تسمح بتحديث الرقم` },
      { status: 400 }
    );
  }

  // Update the phone + bump account_status to 'pending_verification'
  // (in case it was 'pending' from a partial v73 apply).
  const { data: updated, error: updateErr } = await supabaseServer
    .from('users')
    .update({
      phone: normalizedPhone,
      account_status: 'pending_verification',
      updated_at: new Date().toISOString(),
    })
    .eq('id', auth.user.id)
    .select('id, account_status, phone, phone_verified')
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: `تم تحديث رقم الهاتف إلى ${normalizedPhone}. اضغط "إعادة إرسال الكود" لإرسال كود جديد إلى تليجرام.`,
    profile: updated,
    normalized_phone: normalizedPhone,
  });
}
