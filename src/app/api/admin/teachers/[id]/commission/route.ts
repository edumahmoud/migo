import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

const BodySchema = z.object({
  /**
   * New platform commission percentage for this teacher.
   *   number  → explicit per-teacher override (0-100, 2 decimals)
   *   null    → clears the override → teacher falls back to the global
   *             active commission_rates row
   *
   * Validation:
   *   - Must be a finite number OR null
   *   - Number must satisfy 0 <= value <= 100
   *   - Up to 2 decimal places (enforced by NUMERIC(5,2) in DB)
   *
   * HISTORICAL SAFETY (CRITICAL — do not remove this comment):
   *   The patch updates ONLY users.commission_percentage. It does NOT
   *   touch financial_ledger. Each ledger row already has its own
   *   commission_rate SNAPSHOT taken at payment time (v78/v85/v111).
   *   Past transactions keep their original rate FOREVER — only NEW
   *   transactions created after the change use the new rate.
   */
  commission_percentage: z.union([
    z.number().finite().min(0).max(100),
    z.null(),
  ]),
});

/**
 * PATCH /api/admin/teachers/[id]/commission
 *
 * Sets (or clears) the per-teacher platform commission percentage.
 *
 * Body: { commission_percentage: number | null }
 *   - number (0-100): explicit per-teacher override. Future payments
 *     for this teacher use this rate. The rate is snapshotted into
 *     financial_ledger.commission_rate at payment time.
 *   - null: clears the override. Future payments fall back to the
 *     global active commission_rates row.
 *
 * Authorization: admin or superadmin only (requireAdmin).
 *
 * HISTORICAL SAFETY:
 *   - This endpoint updates ONLY users.commission_percentage.
 *   - It does NOT recalculate, modify, or delete any existing
 *     financial_ledger row. Each ledger row keeps its snapshot
 *     commission_rate forever.
 *   - The new rate applies only to NEW transactions created after
 *     this PATCH returns successfully.
 *
 * Response: {
 *   success: true,
 *   teacher_id: string,
 *   teacher_name: string | null,
 *   commission_percentage: number | null,
 *   effective_rate: number,                 // resolved rate (per-teacher or global fallback)
 *   source: 'per_teacher' | 'global' | 'default_zero' | 'unchanged',
 *   historical_note: string,                // safety reminder
 *   updated_at: string,
 * }
 */
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const adminId = auth.user.id;
  const { id: teacherId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'commission_percentage مطلوب (رقم بين 0 و100 أو null)',
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const newValue = parsed.data.commission_percentage;
  // Round to 2 decimals (NUMERIC(5,2) precision). Avoid 5.555 → DB error.
  const roundedValue = newValue === null
    ? null
    : Math.round(newValue * 100) / 100;

  // 1. Verify the target is a teacher.
  const { data: teacher, error: tErr } = await supabaseServer
    .from('users')
    .select('id, role, name, commission_percentage')
    .eq('id', teacherId)
    .maybeSingle();
  if (tErr || !teacher) {
    return NextResponse.json(
      { success: false, error: 'المعلم غير موجود' },
      { status: 404 },
    );
  }
  if ((teacher as { role: string }).role !== 'teacher') {
    return NextResponse.json(
      { success: false, error: 'المستخدم المحدد ليس معلم' },
      { status: 400 },
    );
  }

  const oldValue = (teacher as { commission_percentage: number | null }).commission_percentage;
  const nowIso = new Date().toISOString();

  // 2. Defense-in-depth: if the new value equals the old value, no-op
  //    (avoids a misleading "updated" toast). Still returns the
  //    effective rate so the UI can display the resolved rate.
  if (oldValue === roundedValue || (oldValue === null && roundedValue === null)) {
    return NextResponse.json({
      success: true,
      teacher_id: teacherId,
      teacher_name: (teacher as { name: string | null }).name,
      commission_percentage: oldValue,
      effective_rate: oldValue ?? 0, // best-effort — full resolution below
      source: 'unchanged',
      historical_note: 'لم يتم تغيير النسبة — القيمة الجديدة مطابقة للقيمة الحالية. أي معاملة مالية سابقة تحتفظ بسعرها المسجّل وقت الدفع.',
      updated_at: nowIso,
    });
  }

  // 3. Update ONLY the users.commission_percentage column.
  //    financial_ledger is NEVER touched by this update.
  const { error: updateErr } = await supabaseServer
    .from('users')
    .update({
      commission_percentage: roundedValue,
      updated_at: nowIso,
    })
    .eq('id', teacherId);

  if (updateErr) {
    logPaymentEvent({
      level: 'error',
      operation: 'gatewayManagement',
      success: false,
      message: `Admin ${adminId} FAILED to set commission_percentage=${roundedValue} for teacher ${teacherId}: ${updateErr.message}`,
    });
    return NextResponse.json(
      { success: false, error: `فشل التحديث: ${updateErr.message}` },
      { status: 500 },
    );
  }

  // 4. Resolve the effective rate (for the response). We duplicate the
  //    3-step resolution inline to keep this endpoint thin and avoid
  //    a circular import in tests.
  let effectiveRate: number = roundedValue ?? 0;
  let source: 'per_teacher' | 'global' | 'default_zero' = 'per_teacher';
  if (roundedValue === null) {
    const { data: commissionRow } = await supabaseServer
      .from('commission_rates')
      .select('rate_percentage')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    const globalRate = (commissionRow as { rate_percentage: number } | null)?.rate_percentage;
    if (globalRate !== null && globalRate !== undefined) {
      effectiveRate = globalRate;
      source = 'global';
    } else {
      effectiveRate = 0;
      source = 'default_zero';
    }
  }

  logPaymentEvent({
    level: 'info',
    operation: 'gatewayManagement',
    success: true,
    message: `Admin ${adminId} set commission_percentage=${roundedValue} for teacher ${teacherId} (was ${oldValue}). New payments will use the new rate; existing financial_ledger rows are unchanged.`,
  });

  return NextResponse.json({
    success: true,
    teacher_id: teacherId,
    teacher_name: (teacher as { name: string | null }).name,
    commission_percentage: roundedValue,
    effective_rate: effectiveRate,
    source,
    historical_note: 'تم تحديث النسبة للمعلم. القيمة الجديدة تنطبق فقط على المعاملات المالية الجديدة بعد الآن. المعاملات السابقة محفوظة بسعرها الأصلي المسجّل وقت الدفع — لا يتم إعادة حسابها أو تعديلها.',
    updated_at: nowIso,
  });
}
