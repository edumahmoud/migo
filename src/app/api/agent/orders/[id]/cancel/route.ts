import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * POST /api/agent/orders/[id]/cancel
 *
 * Cancels a pending student order. Used by the registration agent
 * when the student changes their mind or the order is stale.
 *
 * Authorization:
 *   - Caller must be a registration_agent
 *   - The order's subject must belong to the agent's teacher
 *     (subject.teacher_id = agent's sourceTeacherId)
 *
 * Validation:
 *   - Order status must be 'pending'
 *
 * After cancellation:
 *   - orders.status flips to 'cancelled'
 *   - The student can create a new order for the same subject
 *
 * NOTE: This does NOT call Paymob to refund. For real refunds, use
 * the admin financial-ledger refund endpoint.
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: orderId } = await ctx.params;
  const { sourceTeacherId } = auth;

  // Validate orderId is a UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json(
      { success: false, error: 'معرّف الطلب غير صالح' },
      { status: 400 },
    );
  }

  // 1. Fetch the order + verify the subject belongs to the agent's teacher
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      provider_order_ref, gateway_id, checkout_session_id,
      subjects:subject_id (teacher_id, name)
    `)
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب الطلب' },
      { status: 500 },
    );
  }

  if (!order) {
    return NextResponse.json(
      { success: false, error: 'الطلب غير موجود' },
      { status: 404 },
    );
  }

  const o = order as unknown as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    status: string;
    provider_order_ref: string | null;
    gateway_id: string | null;
    checkout_session_id: string | null;
    subjects: { teacher_id: string; name: string } | null;
  };

  // 2. Verify the subject belongs to the agent's teacher
  if (!o.subjects || o.subjects.teacher_id !== sourceTeacherId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — هذا المقرر لا ينتمي إلى معلمك' },
      { status: 403 },
    );
  }

  // 3. Validate status is pending
  if (o.status !== 'pending') {
    return NextResponse.json(
      {
        success: false,
        error: `حالة الطلب: ${o.status} — يمكن إلغاء الطلبات المعلّقة فقط`,
      },
      { status: 400 },
    );
  }

  // 4. Cancel the order
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'pending'); // defense-in-depth

  if (updateErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر إلغاء الطلب' },
      { status: 500 },
    );
  }

  logPaymentEvent({
    level: 'info',
    operation: 'createPayment',
    orderId: orderId,
    success: false,
    errorCode: 'ORDER_CANCELLED_BY_AGENT',
    message: `Order ${orderId} cancelled by agent ${auth.user.id}`,
  });

  return NextResponse.json({
    success: true,
    order_id: orderId,
    status: 'cancelled',
    message: 'تم إلغاء الطلب بنجاح. يمكن للطالب إنشاء طلب جديد للمقرر إذا رغب.',
  });
}
