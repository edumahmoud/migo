import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/orders/[id]
 *
 * Returns the order status + payments for the calling student's own order.
 * The order's student_id must match auth.uid() (enforced by RLS + the
 * explicit check below).
 *
 * Used by the activation page to poll payment status (in case the student
 * is paying manually via Fawry/InstaPay and an admin approves later).
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;

  const { data: order, error } = await supabaseServer
    .from('orders')
    .select(
      'id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, provider, status, created_at, paid_at, activated_at, fees_breakdown, ' +
        'subject:subjects!inner(id, name, level, sub_level, teacher_id), ' +
        'payments(id, provider_payment_id, amount, currency, status, created_at, confirmed_by), ' +
        'order_fees(id, code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount, sort_order)'
    )
    .eq('id', id)
    .single();

  if (error || !order) {
    return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
  }

  // Ownership check (defense-in-depth on top of RLS).
  if ((order as unknown as { student_id: string }).student_id !== auth.user.id) {
    return NextResponse.json(
      { success: false, error: 'لا تملك صلاحية الوصول لهذا الطلب' },
      { status: 403 }
    );
  }

  // v93+ — if fees_breakdown is empty (order created before v93), try to
  // reconstruct it from order_fees rows (the snapshot table from v88).
  const orderData = order as unknown as Record<string, unknown>;
  const existingBreakdown = orderData.fees_breakdown as Array<Record<string, unknown>> | null;
  const orderFees = orderData.order_fees as Array<Record<string, unknown>> | null;
  if ((!existingBreakdown || existingBreakdown.length === 0) && orderFees && orderFees.length > 0) {
    orderData.fees_breakdown = orderFees.map((f) => ({
      code: f.code,
      name_ar: f.name_ar,
      name_en: f.name_en,
      fee_kind: f.fee_kind,
      value: Number(f.value),
      base_amount: Number(f.base_amount),
      calculated_amount: Number(f.calculated_amount),
    }));
  }

  // v117 — backfill base_amount / fees_total / grand_total if they're NULL
  // but order_fees rows exist. This fixes the "fees show 0" bug on orders
  // created by code paths that wrote order_fees rows but didn't populate
  // the orders.* columns (e.g., some v88 edge cases, or orders created
  // before v88 was fully applied).
  if (orderFees && orderFees.length > 0) {
    const amount = Number(orderData.amount ?? 0);
    if (orderData.base_amount === null || orderData.base_amount === undefined) {
      // Reconstruct: base_amount = amount - SUM(order_fees.calculated_amount)
      const feesTotal = orderFees.reduce(
        (sum, f) => sum + Number(f.calculated_amount ?? 0), 0,
      );
      orderData.base_amount = Math.round((amount - feesTotal) * 100) / 100;
    }
    if (orderData.fees_total === null || orderData.fees_total === undefined) {
      orderData.fees_total = orderFees.reduce(
        (sum, f) => sum + Number(f.calculated_amount ?? 0), 0,
      );
    }
    if (orderData.grand_total === null || orderData.grand_total === undefined) {
      orderData.grand_total = amount;
    }
  }

  return NextResponse.json({ success: true, order });
}
