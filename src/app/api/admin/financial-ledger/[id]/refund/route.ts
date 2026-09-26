import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/financial-ledger/[id]/refund
 *
 * Marks a financial ledger record as 'refunded'.
 *
 * Rules:
 *   - Does NOT delete the ledger record.
 *   - Does NOT delete the payment.
 *   - Does NOT modify gross_amount, teacher_share, platform_share,
 *     commission_rate, or net_amount (historical values are immutable).
 *   - Changes ONLY the status to 'refunded'.
 *   - Prevents duplicate refunds (if already 'refunded' → 400).
 *   - Does NOT execute a real refund with Paymob or any gateway.
 *   - Server-Side authorized (admin/superadmin only).
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  // Fetch the current ledger record
  const { data: ledger, error: fetchErr } = await supabaseServer
    .from('financial_ledger')
    .select('id, status, gross_amount, teacher_share, platform_share')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !ledger) {
    return NextResponse.json({ success: false, error: 'السجل المالي غير موجود' }, { status: 404 });
  }

  const record = ledger as { id: string; status: string; gross_amount: number; teacher_share: number; platform_share: number };

  // Prevent refund if already refunded or reversed
  if (record.status === 'refunded') {
    return NextResponse.json({ success: false, error: 'هذا السجل مُسترد بالفعل' }, { status: 400 });
  }
  if (record.status === 'reversed') {
    return NextResponse.json({ success: false, error: 'هذا السجل معكوس — لا يمكن الاسترداد' }, { status: 400 });
  }
  if (record.status !== 'paid' && record.status !== 'settled') {
    return NextResponse.json({ success: false, error: `لا يمكن استرداد سجل بحالة: ${record.status}` }, { status: 400 });
  }

  // Change ONLY the status — financial values are immutable
  const { error: updateErr } = await supabaseServer
    .from('financial_ledger')
    .update({
      status: 'refunded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', record.status); // conditional — prevent race

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: 'تم تسجيل الاسترداد. القيم المالية التاريخية محفوظة ولم تُعدّل.',
    ledger_id: id,
    new_status: 'refunded',
    immutable_values: {
      gross_amount: record.gross_amount,
      teacher_share: record.teacher_share,
      platform_share: record.platform_share,
    },
  });
}
