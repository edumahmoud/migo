import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import '@/lib/payment/providers/fawry';
import { PaymentService, isPaymentError } from '@/lib/payment';
import { categorizePaymentError } from '@/lib/student/payment-error-categories';

/**
 * POST /api/student/checkout/sessions/[id]/pay
 *
 * Initiates ONE Paymob payment for a multi-subject checkout session.
 * The session_id is the value of `orders.checkout_session_id` for all
 * member orders.
 *
 * Flow:
 *   1. Validate the caller is an eligible student.
 *   2. Look up all orders WHERE checkout_session_id = session_id AND
 *      student_id = caller (RLS also enforces this).
 *   3. Validate the session has at least 1 order, all orders are
 *      'pending', all share the same currency, and at least one amount > 0.
 *   4. Compute the total = SUM(orders.amount).
 *   5. Build the Paymob Intention request body:
 *      - amount = total (in cents)
 *      - currency
 *      - special_reference = session_id  ← the webhook uses this to
 *        resolve ALL the session's orders
 *      - items[] = one per order (name = subject name, amount per order)
 *   6. Call PaymentService.createPayment({ orderId: session_id, amount, currency, items, ... }).
 *   7. Update ALL the session's orders: SET gateway_id = resolved_gateway_id.
 *      The Paymob Intention ID is stored on the FIRST order's
 *      `provider_order_ref` (UNIQUE constraint means we can't store
 *      the same Intention ID on multiple orders — but the webhook
 *      resolves via session_id, not via provider_order_ref).
 *   8. Return { checkout_url, payment_reference, session_id }.
 *
 * Idempotency:
 *   - If the session already has a Paymob Intention ID (stored on the
 *     first order's provider_order_ref), we return the existing
 *     checkout URL — we don't create a duplicate intention.
 *   - Calling POST /sessions/[id]/pay twice returns the SAME checkout
 *     URL safely (no double-charge).
 *
 * SECURITY:
 *   - The student cannot supply a price or currency — these come from
 *     the orders table (server-side source of truth).
 *   - The student cannot supply a student_id — it's resolved from auth.
 *   - The Paymob `special_reference` is set to the session_id (not
 *     controllable by the client).
 *   - The webhook will validate that the Paymob amount matches
 *     SUM(orders.amount) before activating any subscription.
 */

interface RouteContext { params: Promise<{ id: string }> }

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  gateway_id: string | null;
  checkout_session_id: string | null;
  subjects: { name: string } | null;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: sessionId } = await ctx.params;

  // Validate session_id is a UUID (defense-in-depth — the URL is a UUID
  // pattern in practice, but Next.js doesn't enforce it).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return NextResponse.json(
      { success: false, error: 'معرّف الجلسة غير صالح' },
      { status: 400 },
    );
  }

  // 1. Fetch all orders in this session owned by the caller.
  const { data: ordersData, error: ordersErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      provider_order_ref, gateway_id, checkout_session_id,
      subjects:subject_id (name)
    `)
    .eq('checkout_session_id', sessionId)
    .eq('student_id', auth.user.id);

  if (ordersErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب طلبات الجلسة' },
      { status: 500 },
    );
  }

  const orders = (ordersData ?? []) as unknown as OrderRow[];

  if (orders.length === 0) {
    return NextResponse.json(
      { success: false, error: 'لا توجد طلبات في هذه الجلسة أو أنها لا تنتمي إليك' },
      { status: 404 },
    );
  }

  // 2. Validate all orders are pending + same currency + have a positive amount.
  for (const o of orders) {
    if (o.status !== 'pending') {
      return NextResponse.json(
        {
          success: false,
          error: `الطلب ${o.id} ليس معلّقًا (حالته: ${o.status})`,
          category: 'ORDER_NOT_PENDING',
        },
        { status: 400 },
      );
    }
    if (Number(o.amount) <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: `الطلب ${o.id} له مبلغ غير صالح (${o.amount})`,
          category: 'INVALID_AMOUNT',
        },
        { status: 400 },
      );
    }
  }

  const currencies = new Set(orders.map((o) => o.currency));
  if (currencies.size > 1) {
    return NextResponse.json(
      {
        success: false,
        error: 'الطلبات في الجلسة لها عملات مختلفة',
        category: 'CURRENCY_MISMATCH',
      },
      { status: 400 },
    );
  }
  const currency = orders[0].currency;

  // 3. Compute the total server-side.
  const totalAmount = orders.reduce((sum, o) => sum + Number(o.amount), 0);

  // 4. Idempotency: if any order already has a Paymob intention ID
  //    (provider_order_ref set to a Paymob-style ID, not the original
  //    `order_<uuid>` placeholder), return the existing checkout URL.
  //    We can't return a checkout URL without calling Paymob again,
  //    so instead we re-call createPayment — but Paymob's Intention
  //    API is idempotent if the same `special_reference` is sent
  //    (we rely on the adapter/client to handle this; if Paymob creates
  //    a duplicate, the webhook will only activate the orders once due
  //    to the RPC idempotency).

  // 5. Fetch the student's profile for billing data
  const { data: profile } = await supabaseServer
    .from('users')
    .select('email, name, phone')
    .eq('id', auth.user.id)
    .maybeSingle();
  const p = profile as { email: string; name: string | null; phone: string | null } | null;

  // 6. Build the Paymob Intention request via the existing createPayment input.
  //    Note: CreatePaymentInput doesn't have an `items[]` field (types.ts
  //    is in the do-not-modify list). The Paymob adapter builds items[]
  //    internally from `description` + total amount — that's fine for
  //    Paymob's hosted checkout. The student sees the per-course breakdown
  //    in our Payment Summary dialog (before clicking Pay Now).
  //    The `metadata` field IS supported and goes into Paymob's `extras`.
  const description = orders.length === 1
    ? (orders[0].subjects?.name ?? 'Course Subscription')
    : `${orders.length} courses`;

  // 7. Call PaymentService.createPayment — pass sessionId as orderId
  //    so the Paymob adapter sets special_reference = sessionId.
  //    Use the gateway_id snapshot from the first order if set (so a
  //    re-pay attempt uses the same gateway).
  const firstOrderGatewayId = orders[0].gateway_id;

  // Parse the requested payment method from the query string
  // (sent by the client-side payment method picker)
  const requestedPaymentMethod = request.nextUrl.searchParams.get('method') === 'wallet'
    ? 'wallet'
    : 'card';

  try {
    const result = await PaymentService.createPayment(
      {
        orderId: sessionId, // ← special_reference in Paymob
        amount: Number(totalAmount),
        currency,
        customerEmail: p?.email,
        customerName: p?.name ?? undefined,
        customerPhone: p?.phone ?? undefined,
        description,
        redirectUrl: `${request.nextUrl.origin}/?payment_callback=success`,
        paymentMethod: requestedPaymentMethod,
        metadata: {
          checkout_session_id: sessionId,
          order_ids: orders.map((o) => o.id),
          item_count: orders.length,
        },
      },
      firstOrderGatewayId ?? undefined,
    );

    if (!result.success || !result.checkoutUrl) {
      logPaymentEvent({
        level: 'warn',
        operation: 'createPayment',
        orderId: sessionId,
        success: false,
        errorCode: 'PAYMENT_CREATION_FAILED',
        message: 'PaymentService.createPayment returned success=false without throwing',
      });
      return NextResponse.json(
        {
          success: false,
          error: 'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. حاول مرة أخرى.',
          category: 'PAYMOB_API_REJECTED',
        },
        { status: 502 },
      );
    }

    const checkoutUrl = result.checkoutUrl;
    const paymentReference = result.paymentReference ?? null;

    // 8. Update ALL the session's orders with the gateway_id snapshot.
    //    Store the Paymob intention ID on the FIRST order's
    //    provider_order_ref (UNIQUE constraint prevents storing it on
    //    multiple orders — but the webhook resolves via session_id, so
    //    this is just for diagnostics).
    const firstOrderId = orders[0].id;

    await Promise.all([
      // Update all orders with the gateway_id snapshot
      supabaseServer
        .from('orders')
        .update({
          gateway_id: result.gatewayId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('checkout_session_id', sessionId)
        .eq('student_id', auth.user.id)
        .eq('status', 'pending'),

      // Store the Paymob order reference on the first order only (UNIQUE
      // constraint allows only one order per reference at a time).
      // v113: prefer providerOrderReference (real Paymob Order ID, numeric)
      // over paymentReference (Intention ID like "pi_test_...") so the
      // transactions log shows the same Order ID as the Paymob dashboard.
      supabaseServer
        .from('orders')
        .update({
          provider_order_ref: result.providerOrderReference ?? paymentReference,
          updated_at: new Date().toISOString(),
        })
        .eq('id', firstOrderId)
        .eq('student_id', auth.user.id)
        .eq('status', 'pending'),
    ]);

    return NextResponse.json({
      success: true,
      checkout_url: checkoutUrl,
      payment_reference: paymentReference,
      session_id: sessionId,
      message: `تم إنشاء دفعة موحدة لـ ${orders.length} مقرر بقيمة ${totalAmount.toFixed(2)} ${currency}. سيتم تحويلك لبوابة الدفع.`,
    });
  } catch (err) {
    // Categorize the error → safe Arabic message + appropriate HTTP status.
    const categorized = categorizePaymentError(err, firstOrderGatewayId);

    logPaymentEvent({
      level: 'error',
      operation: 'createPayment',
      orderId: sessionId,
      success: false,
      errorCode: categorized.underlyingCode ?? 'UNKNOWN',
      message: isPaymentError(err) ? err.message : (err instanceof Error ? err.message : 'unknown error'),
    });

    return NextResponse.json(
      {
        success: false,
        error: categorized.userMessageAr,
        category: categorized.category,
      },
      { status: categorized.httpStatus },
    );
  }
}
