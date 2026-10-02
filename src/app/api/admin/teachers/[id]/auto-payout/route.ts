import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

const BodySchema = z.object({
  enabled: z.boolean(),
});

/**
 * PATCH /api/admin/teachers/[id]/auto-payout
 *
 * Toggles the per-teacher `auto_payout_enabled` flag. When TRUE
 * AND the platform-wide AUTO_PAYOUT_FEATURE_ENABLED env var is also
 * TRUE AND PAYMOB_DISBURSEMENT_API_KEY is set, the manual settle
 * endpoint will route through the Paymob disbursement adapter
 * (REAL money transfer to the teacher's wallet/bank). When FALSE,
 * the settle endpoint uses the existing manual flow (DB-only
 * status change, no real money transfer).
 *
 * Body: { enabled: boolean }
 *
 * Response: {
 *   success: true,
 *   teacher_id: string,
 *   auto_payout_enabled: boolean,
 *   feature_globally_enabled: boolean,  // reflects AUTO_PAYOUT_FEATURE_ENABLED env var
 *   paymob_configured: boolean           // reflects PAYMOB_DISBURSEMENT_API_KEY presence
 * }
 *
 * Authorization: admin/superadmin only.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: teacherId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'enabled مطلوب ويجب أن يكون boolean', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { enabled } = parsed.data;

  // Verify the target is a teacher
  const { data: teacher, error: tErr } = await supabaseServer
    .from('users')
    .select('id, role, name')
    .eq('id', teacherId)
    .maybeSingle();
  if (tErr || !teacher) {
    return NextResponse.json({ success: false, error: 'المعلم غير موجود' }, { status: 404 });
  }
  if ((teacher as { role: string }).role !== 'teacher') {
    return NextResponse.json({ success: false, error: 'المستخدم المحدد ليس معلم' }, { status: 400 });
  }

  // Update the flag
  const { error: updateErr } = await supabaseServer
    .from('users')
    .update({ auto_payout_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', teacherId);
  if (updateErr) {
    return NextResponse.json(
      { success: false, error: `فشل التحديث: ${updateErr.message}` },
      { status: 500 },
    );
  }

  logPaymentEvent({
    level: 'info',
    operation: 'gatewayManagement',
    success: true,
    message: `Admin ${auth.user.id} set auto_payout_enabled=${enabled} for teacher ${teacherId}`,
  });

  // Report the platform-wide state so the UI can warn the user
  // (e.g., "feature is enabled but Paymob is not configured")
  const featureGloballyEnabled = process.env.AUTO_PAYOUT_FEATURE_ENABLED === 'true';
  const paymobConfigured = !!(
    process.env.PAYMOB_DISBURSEMENT_API_KEY &&
    process.env.PAYMOB_DISBURSEMENT_BASE_URL
  );

  return NextResponse.json({
    success: true,
    teacher_id: teacherId,
    teacher_name: (teacher as { name: string | null }).name,
    auto_payout_enabled: enabled,
    feature_globally_enabled: featureGloballyEnabled,
    paymob_configured: paymobConfigured,
    warning: enabled && (!featureGloballyEnabled || !paymobConfigured)
      ? 'تم تفعيل الإعداد لهذا المعلم، لكن الميزة غير مفعّلة على مستوى المنصة (AUTO_PAYOUT_FEATURE_ENABLED أو مفاتيح Paymob غير مضبوطة). التسوية ستظل يدوية حتى تكتمل الإعدادات.'
      : null,
  });
}
