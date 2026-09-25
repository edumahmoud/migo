import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/orders/switch-to-automatic
 *
 * Switches ALL of the calling student's pending manual-confirmation
 * orders to automatic mode. This enables the auto-activation flow:
 *   1. Orders become confirmation_mode='automatic'
 *   2. Frontend redirects to /api/payment/mock-checkout?order_id=...
 *   3. Student clicks "Pay" → /api/payment/mock-pay
 *   4. mock-pay calls /api/payment/webhook (HMAC-signed)
 *   5. webhook calls activate_subscription_after_payment RPC
 *   6. RPC atomically: marks order paid + creates enrollment + activates student
 *
 * In production, this is the path for card / online payment gateways
 * (Paymob, Fawry Online, Stripe). The mock gateway simulates them.
 *
 * Authorization: student must own the orders + orders must be 'pending'
 * with confirmation_mode='manual'.
 *
 * Returns: { success, switched_count, first_order_id, checkout_url }
 */
export async function POST(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Fetch all the student's pending manual-confirmation orders.
  const { data: orders, error: fetchErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, status, confirmation_mode, amount, currency, subject_id')
    .eq('student_id', auth.user.id)
    .eq('status', 'pending')
    .eq('confirmation_mode', 'manual')
    .order('created_at', { ascending: 'asc' })
    .limit(50);

  if (fetchErr) {
    return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json(
      { success: false, error: 'لا توجد طلبات قابلة للتحويل. أنشئ طلبات أولاً.' },
      { status: 404 }
    );
  }

  const orderIds = (orders as Array<{ id: string }>).map((o) => o.id);

  // 2. Update them all to automatic mode.
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({
      confirmation_mode: 'automatic',
      updated_at: new Date().toISOString(),
    })
    .in('id', orderIds)
    .eq('student_id', auth.user.id) // extra safety
    .eq('status', 'pending')
    .eq('confirmation_mode', 'manual');

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  const firstOrderId = orderIds[0];

  return NextResponse.json({
    success: true,
    switched_count: orderIds.length,
    first_order_id: firstOrderId,
    checkout_url: `/api/payment/mock-checkout?order_id=${firstOrderId}`,
    message: `تم تحويل ${orderIds.length} طلب للدفع الفوري. سيتم تحويلك لبوابة الدفع.`,
  });
}
