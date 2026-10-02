import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/financial-ledger/[id]/settle
 *
 * Marks a financial ledger record as 'settled'.
 *
 * This is a STATUS-ONLY change. It does NOT:
 *   - Execute a bank transfer.
 *   - Execute a mobile wallet transfer.
 *   - Execute an InstaPay transfer.
 *   - Perform any payout.
 *
 * It simply records that the financial record has been settled
 * (e.g., the teacher has been paid outside the system, and the
 * admin is recording this fact).
 *
 * Rules:
 *   - Only 'paid' records can be settled.
 *   - Prevents duplicate settlement.
 *   - Does NOT modify financial values.
 *   - Server-Side authorized (admin/superadmin only).
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  // Fetch the current record
  const { data: ledger, error: fetchErr } = await supabaseServer
    .from('financial_ledger')
    .select('id, status, teacher_share, currency')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !ledger) {
    return NextResponse.json({ success: false, error: 'السجل المالي غير موجود' }, { status: 404 });
  }

  const record = ledger as { id: string; status: string; teacher_share: number; currency: string };

  // Prevent settlement if already settled
  if (record.status === 'settled') {
    return NextResponse.json({ success: false, error: 'هذا السجل مسوّى بالفعل' }, { status: 400 });
  }
  // Only 'paid' records can be settled
  if (record.status !== 'paid') {
    return NextResponse.json({ success: false, error: `لا يمكن تسوية سجل بحالة: ${record.status} (يجب أن يكون 'paid')` }, { status: 400 });
  }

  // Change ONLY the status
  const { error: updateErr } = await supabaseServer
    .from('financial_ledger')
    .update({
      status: 'settled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'paid'); // conditional — prevent race

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: `تم تسوية السجل (${record.teacher_share} ${record.currency}). لم يتم تنفيذ أي تحويل فعلي.`,
    ledger_id: id,
    new_status: 'settled',
    teacher_share: record.teacher_share,
    currency: record.currency,
  });
}
