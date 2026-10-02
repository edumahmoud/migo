import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * POST /api/teacher/orders/[id]/cancel
 *
 * Cancels a pending student order. Used by the teacher when:
 *   - The student changed their mind and asked the teacher to cancel
 *   - The order is stale (e.g., created by mistake, never paid)
 *   - The teacher wants to free up the subject for a new payment attempt
 *
 * After cancellation:
 *   - orders.status flips to 'cancelled'
 *   - The student can create a new order for the same subject
 *   - If the order was part of a multi-subject checkout session, the
 *     other orders in the session remain pending (cancellation is
 *     per-order, not per-session)
 *
 * Authorization:
 *   - Caller must be teacher/admin/superadmin
 *   - The order's subject must belong to the teacher (subjects.teacher_id = auth.user.id)
 *
 * Validation:
 *   - Order status must be 'pending' (cannot cancel a paid/failed/refunded order)
 *
 * NOTE: This does NOT call Paymob to refund. If the student had already
 * paid but the webhook hasn't fired yet, the webhook will detect
 * status='cancelled' and refuse to activate (defense-in-depth). For
 * real refunds, use the admin financial-ledger refund endpoint.
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: orderId } = await ctx.params;
  const teacherId = auth.user.id;

  // Validate orderId is a UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json(
      { success: false, error: 'معرّف الطلب غير صالح' },
      { status: 400 },
    );
  }

  // 1. Fetch the order + verify the subject belongs to this teacher
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

  // 2. Verify the subject belongs to this teacher
  if (!o.subjects || o.subjects.teacher_id !== teacherId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — هذا المقرر لا ينتمي إليك' },
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

  // 4. Cancel the order (flip status to 'cancelled')
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'pending'); // defense-in-depth — only flips pending orders

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
    success: false, // cancellation is not a payment
    errorCode: 'ORDER_CANCELLED_BY_TEACHER',
    message: `Order ${orderId} cancelled by teacher ${teacherId}`,
  });

  return NextResponse.json({
    success: true,
    order_id: orderId,
    status: 'cancelled',
    message: 'تم إلغاء الطلب بنجاح. يمكن للطالب إنشاء طلب جديد للمقرر إذا رغب.',
  });
}
