import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/auth/ensure-pending-verification
 *
 * Safety-net called by the frontend right after `signUpWithEmail` completes.
 *
 * Purpose:
 *   In the preferred path, the v73 trigger `handle_new_user()` sets
 *   `account_status='pending_verification'` and stores `phone` from the
 *   auth metadata. But if the v73 migration was only partially applied
 *   (e.g., the CHECK widening didn't take, or the trigger function body
 *   wasn't replaced), the trigger will set `account_status='pending'`
 *   and may not store `phone` at all.
 *
 *   This endpoint uses the service role to:
 *     1. Read the user's auth metadata to recover the phone they passed
 *        at signup (if the DB profile doesn't have it).
 *     2. UPDATE the profile to set:
 *          - phone = (metadata.phone OR existing phone)
 *          - account_status = 'pending_verification'
 *               (only if currently 'pending' or 'pending_verification')
 *     3. Return the updated profile.
 *
 *   This guarantees the user lands in the OTP flow even if the trigger
 *   is misconfigured — as long as the `phone` and `phone_verified`
 *   COLUMNS exist (added by v73 ALTER TABLE).
 *
 *   If those columns don't exist, the endpoint returns an error
 *   instructing the operator to re-run v73.
 *
 * Body (optional): { phone?: string }
 *   If the client passes a phone, it takes precedence over the auth
 *   metadata phone. Useful if the metadata wasn't preserved.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Parse body (optional phone)
  let bodyPhone: string | undefined;
  try {
    const body = await request.json();
    bodyPhone = typeof body?.phone === 'string' ? body.phone.trim() : undefined;
  } catch {
    // body is optional — ignore parse errors
  }

  // 2. Fetch the auth user's metadata (we need the phone they signed up with).
  const { data: userData, error: userErr } = await supabaseServer.auth.admin.getUserById(auth.user.id);
  if (userErr || !userData?.user) {
    return NextResponse.json(
      { success: false, error: 'تعذّر الوصول إلى بيانات المستخدم' },
      { status: 500 }
    );
  }
  const metaPhone = (userData.user.user_metadata as { phone?: string } | null)?.phone || null;

  // 3. Fetch the current DB profile.
  const { data: profile, error: profileErr } = await supabaseServer
    .from('users')
    .select('id, account_status, phone, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (profileErr) {
    const msg = profileErr.message || '';
    if (/column "phone" does not exist/i.test(msg)) {
      return NextResponse.json(
        {
          success: false,
          error: 'عمود الهاتف غير موجود في قاعدة البيانات — يرجى إعادة تطبيق تهجيرة v73 (انظر /api/setup/check-otp-migration)',
          migration_required: true,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف الشخصي غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; account_status: string; phone: string | null; phone_verified: boolean };

  // 4. Decide the new phone value (body > metadata > existing).
  const newPhone = bodyPhone || metaPhone || p.phone;

  // 5. If the user has already verified their phone, don't downgrade.
  if (p.phone_verified === true) {
    return NextResponse.json({
      success: true,
      already_verified: true,
      message: 'تم التحقق من رقم الهاتف مسبقاً.',
      profile: p,
    });
  }

  // 6. Only transition 'pending' → 'pending_verification' or keep as is.
  //    Never touch 'active' or 'suspended'.
  if (p.account_status !== 'pending' && p.account_status !== 'pending_verification') {
    return NextResponse.json({
      success: false,
      error: `حالة الحساب الحالية (${p.account_status}) لا تسمح بإعادة الضبط إلى pending_verification`,
      profile: p,
    }, { status: 400 });
  }

  // 7. UPDATE.
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (newPhone && newPhone !== p.phone) {
    updatePayload.phone = newPhone;
  }
  // Only try to widen the CHECK by setting 'pending_verification' if the
  // current status is 'pending' (the trigger set it due to a partial v73).
  // If it's already 'pending_verification', no change needed.
  if (p.account_status === 'pending') {
    updatePayload.account_status = 'pending_verification';
  }

  const { data: updated, error: updateErr } = await supabaseServer
    .from('users')
    .update(updatePayload)
    .eq('id', auth.user.id)
    .select('id, account_status, phone, phone_verified')
    .maybeSingle();

  if (updateErr) {
    const msg = updateErr.message || '';
    if (/violates check constraint/i.test(msg)) {
      return NextResponse.json(
        {
          success: false,
          error: 'قيد CHECK لا يسمح بحالة pending_verification — يرجى إعادة تطبيق تهجيرة v73 (انظر /api/setup/check-otp-migration)',
          migration_required: true,
          raw_error: msg,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    profile: updated,
    message: 'تم ضبط الحساب لحالة التحقق من الهاتف بنجاح.',
  });
}
