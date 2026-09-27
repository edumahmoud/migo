import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/checkout/sessions/[id]/remove
 *
 * Removes a single order from a multi-subject checkout session.
 *
 * Body: { orderId: string }
 *
 * The endpoint:
 *   1. Validates the session_id is a UUID.
 *   2. Validates the caller is an eligible student.
 *   3. Validates the order exists + belongs to the caller.
 *   4. Validates the order is part of the specified session
 *      (orders.checkout_session_id == session_id).
 *   5. Validates the order is still 'pending' (can't remove a paid order).
 *   6. Validates the order has NOT been initiated for payment yet
 *      (provider_order_ref is still the original placeholder, not a
 *      Paymob intention ID). If payment was already initiated, the
 *      order is "locked" to the session.
 *   7. Updates orders.checkout_session_id = NULL for that order
 *      (removes it from the session).
 *   8. Returns the updated session info (remaining items + new total).
 *
 * Idempotency:
 *   - If the order is NOT in the session, returns 404.
 *   - If the order is already removed (checkout_session_id IS NULL),
 *     returns 404.
 *
 * Security:
 *   - The caller cannot supply a price, currency, or student_id.
 *   - All values are read server-side from the orders table.
 *   - RLS on orders (student_id = auth.uid()) is enforced + the
 *     explicit ownership check.
 */

const BodySchema = z.object({
  orderId: z.string().uuid(),
});

interface RouteContext { params: Promise<{ id: string }> }

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  checkout_session_id: string | null;
  provider_order_ref: string | null;
  gateway_id: string | null;
  subjects: { name: string } | null;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: sessionId } = await ctx.params;

  // Validate session_id is a UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return NextResponse.json(
      { success: false, error: 'معرّف الجلسة غير صالح' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'orderId مطلوب (UUID صالح)' },
      { status: 400 },
    );
  }

  const orderId = parsed.data.orderId;
  const studentId = auth.user.id;

  // 1. Fetch the order + validate ownership + session membership
  const { data: orderData, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      checkout_session_id, provider_order_ref, gateway_id,
      subjects:subject_id (name)
    `)
    .eq('id', orderId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (orderErr || !orderData) {
    return NextResponse.json(
      { success: false, error: 'الطلب غير موجود أو لا ينتمي إلى حسابك' },
      { status: 404 },
    );
  }

  const order = orderData as unknown as OrderRow;

  // 2. Validate the order is part of the specified session
  if (order.checkout_session_id !== sessionId) {
    return NextResponse.json(
      { success: false, error: 'هذا الطلب ليس ضمن الجلسة المحددة' },
      { status: 404 },
    );
  }

  // 3. Validate the order is still pending
  if (order.status !== 'pending') {
    return NextResponse.json(
      {
        success: false,
        error: `لا يمكن إزالة الطلب بحالته الحالية (${order.status})`,
        category: 'ORDER_NOT_PENDING',
      },
      { status: 400 },
    );
  }

  // 4. Validate the order hasn't been initiated for payment yet.
  //    If the admin/student already clicked "Pay Now" and a Paymob
  //    intention was created (provider_order_ref is a Paymob-style ID,
  //    not the original `order_<uuid>` placeholder), the order is
  //    "locked" to the session — removing it would break the
  //    session's amount validation.
  const isPaymentInitiated = order.provider_order_ref
    && !order.provider_order_ref.startsWith('order_')
    && !order.provider_order_ref.startsWith('free_');

  if (isPaymentInitiated) {
    return NextResponse.json(
      {
        success: false,
        error: 'تم بدء عملية الدفع لهذه الجلسة — لا يمكن إزالة الطلبات بعد بدء الدفع.',
        category: 'PAYMENT_ALREADY_INITIATED',
      },
      { status: 409 },
    );
  }

  // 5. Remove the order from the session (set checkout_session_id = NULL)
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({
      checkout_session_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('student_id', studentId)
    .eq('checkout_session_id', sessionId)  // defense-in-depth
    .eq('status', 'pending');

  if (updateErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر إزالة الطلب من الجلسة' },
      { status: 500 },
    );
  }

  // 6. Fetch the remaining session orders + compute the new total
  const { data: remainingData, error: remainingErr } = await supabaseServer
    .from('orders')
    .select(`
      id, subject_id, amount, currency,
      subjects:subject_id (name)
    `)
    .eq('checkout_session_id', sessionId)
    .eq('student_id', studentId)
    .eq('status', 'pending');

  const remainingOrders = (remainingData ?? []) as unknown as Array<{
    id: string;
    subject_id: string;
    amount: number;
    currency: string;
    subjects: { name: string } | null;
  }>;

  if (remainingErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب الطلبات المتبقية' },
      { status: 500 },
    );
  }

  const items = remainingOrders.map((o) => ({
    order_id: o.id,
    subject_id: o.subject_id,
    subject_name: o.subjects?.name ?? '—',
    amount: Number(o.amount),
    currency: o.currency,
  }));

  const totalAmount = items.reduce((sum, it) => sum + Number(it.amount), 0);
  const currency = items[0]?.currency ?? 'EGP';

  return NextResponse.json({
    success: true,
    session_id: sessionId,
    items,
    total_amount: Number(totalAmount.toFixed(2)),
    currency,
    item_count: items.length,
    removed_order_id: orderId,
    message: items.length === 0
      ? 'تمت إزالة الطلب. الجلسة فارغة الآن.'
      : `تمت إزالة الطلب. تبقى ${items.length} مقرر بقيمة ${totalAmount.toFixed(2)} ${currency}.`,
  });
}
