import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * POST /api/admin/teachers/bulk-toggle-auto-payout
 *
 * Toggles the `auto_payout_enabled` flag for ALL teachers who have
 * pending payouts due (i.e., teachers with at least one
 * financial_ledger row in status='paid' that's not yet linked to a
 * payout).
 *
 * Body: {
 *   enabled: boolean,         // TRUE = enable auto-payout for all
 *                             // FALSE = disable for all
 *   teacher_ids?: string[],  // optional explicit list (UUIDs); if
 *                             // omitted, applies to ALL teachers with
 *                             // due payouts
 * }
 *
 * Response: {
 *   success: true,
 *   updated_count: number,
 *   skipped_count: number,
 *   summary: { total_in_scope, updated, skipped }
 * }
 *
 * Why filter by "has pending payouts":
 *   Admins typically only want to toggle the flag for teachers they're
 *   about to settle with. Toggling for teachers with no due payouts
 *   would be noise. The UI provides this filter so the "Enable All"
 *   button matches what the admin sees on screen.
 *
 * Authorization: admin/superadmin only.
 */
const BodySchema = z.object({
  enabled: z.boolean(),
  teacher_ids: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const adminId = auth.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { enabled, teacher_ids: explicitIds } = parsed.data;

  // Determine which teachers to update:
  //   - If explicitIds provided → use them (still validate role='teacher')
  //   - Otherwise → find all teachers with at least one paid ledger row
  //     not linked to any payout (i.e., they have due payouts)
  let targetIds: string[] = [];

  if (explicitIds && explicitIds.length > 0) {
    // Validate the IDs are teachers
    const { data: teachers, error: tErr } = await supabaseServer
      .from('users')
      .select('id, role')
      .in('id', explicitIds)
      .eq('role', 'teacher');
    if (tErr) {
      return NextResponse.json(
        { success: false, error: `فشل التحقق من المعلمين: ${tErr.message}` },
        { status: 500 },
      );
    }
    targetIds = (teachers ?? []).map((t: { id: string }) => t.id);
    if (targetIds.length === 0) {
      return NextResponse.json({
        success: true,
        updated_count: 0,
        skipped_count: explicitIds.length,
        summary: { total_in_scope: explicitIds.length, updated: 0, skipped: explicitIds.length },
        message: 'لا يوجد معلمون صالحون في القائمة المحددة',
      });
    }
  } else {
    // Find all teachers with due payouts (paid ledger entries not linked to any payout)
    // Step 1: get all paid ledger entries (no JOIN needed)
    const { data: paidEntries, error: pErr } = await supabaseServer
      .from('financial_ledger')
      .select('id, teacher_id')
      .eq('status', 'paid');
    if (pErr) {
      return NextResponse.json(
        { success: false, error: `فشل جلب المدفوعات: ${pErr.message}` },
        { status: 500 },
      );
    }
    const paidByTeacher = new Map<string, string[]>();
    for (const e of (paidEntries ?? []) as Array<{ id: string; teacher_id: string }>) {
      if (!paidByTeacher.has(e.teacher_id)) paidByTeacher.set(e.teacher_id, []);
      paidByTeacher.get(e.teacher_id)!.push(e.id);
    }
    if (paidByTeacher.size === 0) {
      return NextResponse.json({
        success: true,
        updated_count: 0,
        skipped_count: 0,
        summary: { total_in_scope: 0, updated: 0, skipped: 0 },
        message: 'لا يوجد معلمون لهم مبالغ مستحقة',
      });
    }
    // Step 2: filter out teachers whose ledger entries are ALL already linked to a payout
    const allLedgerIds = [...paidByTeacher.values()].flat();
    const { data: linkedIds, error: lErr } = await supabaseServer
      .from('teacher_payout_ledger_entries')
      .select('ledger_id')
      .in('ledger_id', allLedgerIds);
    if (lErr) {
      return NextResponse.json(
        { success: false, error: `فشل جلب الروابط: ${lErr.message}` },
        { status: 500 },
      );
    }
    const linkedSet = new Set((linkedIds ?? []).map((l: { ledger_id: string }) => l.ledger_id));
    // Teachers with at least ONE unlinked paid ledger entry
    targetIds = [...paidByTeacher.entries()]
      .filter(([, ids]) => ids.some((id) => !linkedSet.has(id)))
      .map(([tid]) => tid);
    if (targetIds.length === 0) {
      return NextResponse.json({
        success: true,
        updated_count: 0,
        skipped_count: 0,
        summary: { total_in_scope: 0, updated: 0, skipped: 0 },
        message: 'كل المعلمين تمت تسويتهم بالفعل — لا يوجد مستحقات قيد الانتظار',
      });
    }
  }

  // Bulk update
  const { error: updateErr } = await supabaseServer
    .from('users')
    .update({ auto_payout_enabled: enabled, updated_at: new Date().toISOString() })
    .in('id', targetIds)
    .eq('role', 'teacher');

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
    message: `Admin ${adminId} bulk-set auto_payout_enabled=${enabled} for ${targetIds.length} teachers`,
  });

  return NextResponse.json({
    success: true,
    updated_count: targetIds.length,
    skipped_count: explicitIds ? explicitIds.length - targetIds.length : 0,
    summary: {
      total_in_scope: targetIds.length,
      updated: targetIds.length,
      skipped: explicitIds ? explicitIds.length - targetIds.length : 0,
    },
    auto_payout_enabled: enabled,
    message: `تم ${enabled ? 'تفعيل' : 'تعطيل'} الدفع التلقائي لـ ${targetIds.length} معلم`,
  });
}
