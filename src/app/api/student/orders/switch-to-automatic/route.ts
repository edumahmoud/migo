import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/orders/switch-to-automatic
 *
 * Body: { action?: 'to-automatic' | 'to-manual' }   default: 'to-automatic'
 *
 * - 'to-automatic' (default): switches ALL pending manual orders → automatic.
 *   Used when student picks "دفع فوري" (card / online payment).
 * - 'to-manual': switches ALL pending automatic orders → manual.
 *   Used as a recovery path when student switched to automatic but
 *   didn't complete the gateway checkout — the orders are stuck in
 *   'automatic' mode (invisible to supervisor). This makes them
 *   visible again so the student can either retry card payment OR
 *   switch to manual with proof.
 *
 * Authorization: student must own the orders + orders must be 'pending'.
 */
export async function POST(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  // Parse optional body
  let action: 'to-automatic' | 'to-manual' = 'to-automatic';
  try {
    const body = await request.json();
    if (body?.action === 'to-manual') action = 'to-manual';
  } catch { /* default to to-automatic */ }

  const fromMode = action === 'to-automatic' ? 'manual' : 'automatic';
  const toMode = action === 'to-automatic' ? 'automatic' : 'manual';

  // 1. Fetch the student's pending orders in the source mode.
  const { data: orders, error: fetchErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, status, confirmation_mode, amount, currency, subject_id')
    .eq('student_id', auth.user.id)
    .eq('status', 'pending')
    .eq('confirmation_mode', fromMode)
    .order('created_at', { ascending: true })
    .limit(50);

  if (fetchErr) {
    return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json(
      { success: false, error: `لا توجد طلبات pending بصيغة '${fromMode}' قابلة للتحويل.` },
      { status: 404 }
    );
  }

  const orderIds = (orders as Array<{ id: string }>).map((o) => o.id);

  // 2. Update them all to the target mode.
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({
      confirmation_mode: toMode,
      updated_at: new Date().toISOString(),
    })
    .in('id', orderIds)
    .eq('student_id', auth.user.id)
    .eq('status', 'pending')
    .eq('confirmation_mode', fromMode);

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  const response: Record<string, unknown> = {
    success: true,
    switched_count: orderIds.length,
    action,
    message: `تم تحويل ${orderIds.length} طلب إلى '${toMode}'.`,
  };

  // If switching to automatic, return the checkout URL.
  if (action === 'to-automatic') {
    const firstOrderId = orderIds[0];
    response.first_order_id = firstOrderId;
    response.checkout_url = `/api/payment/mock-checkout?order_id=${firstOrderId}`;
  }

  return NextResponse.json(response);
}
