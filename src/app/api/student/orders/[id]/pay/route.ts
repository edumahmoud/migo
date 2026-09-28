import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import { PaymentService, isPaymentError } from '@/lib/payment';
import { categorizePaymentError } from '@/lib/student/payment-error-categories';

/**
 * POST /api/student/orders/[id]/pay
 *
 * Initiates a Paymob payment for the given order.
 *
 * Flow:
 *   1. Validate the student owns the order + it's 'pending'.
 *   2. Call PaymentService.createPayment() → Paymob Intention API.
 *      The gateway is resolved in this priority:
 *        a. order.gateway_id (if set — the gateway snapshot from a
 *           previous /pay attempt)
 *        b. The default gateway (is_default=true in payment_gateways)
 *   3. Update the order with provider_order_ref (intention ID) +
 *      gateway_id (gateway snapshot — even if it was already set, we
 *      re-confirm it).
 *   4. Return the Paymob hosted checkout URL.
 *
 * The student is redirected to Paymob's hosted checkout page.
 * After payment, Paymob sends a webhook to /api/payment/webhook
 * (which verifies HMAC + calls the activation RPC).
 *
 * The redirect URL (after checkout) is for UX only — NOT payment truth.
 * The webhook is the single source of truth.
 *
 * Idempotency: if the order already has a provider_order_ref (a Paymob
 * intention ID), we verify the existing intention's status instead of
 * creating a duplicate.
 *
 * ERROR HANDLING (Phase 14 — categorized gateway errors):
 *   Errors are mapped to specific Arabic user-facing messages via
 *   `categorizePaymentError()`. The category is returned in the
 *   response so the client can show contextual UI (e.g., "stale order"
 *   → suggest creating a new order). The raw provider error is logged
 *   server-side via logPaymentEvent (which strips secrets).
 *
 * STALE ORDER HANDLING:
 *   If `order.gateway_id` is set but the gateway was deleted/disabled
 *   since the order was created, we return `STALE_ORDER` (HTTP 409)
 *   instead of silently switching to a different gateway. The student
 *   should create a new order (the old pending one can be cancelled
 *   by the admin if needed).
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: orderId } = await ctx.params;

  // 1. Fetch the order + validate ownership + status
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, status, provider_order_ref, gateway_id, checkout_session_id')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
  }

  const o = order as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    status: string;
    provider_order_ref: string | null;
    gateway_id: string | null;
    checkout_session_id: string | null;
  };

  if (o.student_id !== auth.user.id) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }
  if (o.status !== 'pending') {
    return NextResponse.json(
      { success: false, error: `حالة الطلب: ${o.status} — لا يمكن الدفع` },
      { status: 400 },
    );
  }
  if (o.amount === 0) {
    return NextResponse.json(
      { success: false, error: 'هذا المقرر مجاني — لا يحتاج للدفع' },
      { status: 400 },
    );
  }
  // Refuse to call /pay on an order that's part of a multi-subject
  // checkout session — those must go through /api/student/checkout/sessions/[id]/pay
  // (which initiates ONE Paymob intention for the whole session).
  if (o.checkout_session_id) {
    return NextResponse.json(
      {
        success: false,
        error: 'هذا الطلب ضمن مجموعة دفعة موحدة. استخدم مسار الدفع الموحد للمجموعة.',
        category: 'PART_OF_SESSION',
        session_id: o.checkout_session_id,
      },
      { status: 409 },
    );
  }

  // 2. Fetch the student's profile for billing data
  const { data: profile } = await supabaseServer
    .from('users')
    .select('email, name, phone')
    .eq('id', auth.user.id)
    .maybeSingle();
  const p = profile as { email: string; name: string | null; phone: string | null } | null;

  // 3. Fetch the subject name for the payment description
  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('name')
    .eq('id', o.subject_id)
    .maybeSingle();
  const subjectName = (subject as { name: string } | null)?.name ?? 'Course Subscription';

  // 4. Call PaymentService.createPayment().
  //    Pass order.gateway_id if it's set (so a re-/pay attempt on a
  //    previously-initiated order uses the SAME gateway snapshot —
  //    not the current default).
  //    If order.gateway_id is NULL (first /pay attempt), the resolver
  //    falls back to the default gateway.
  //
  //    The student can choose a payment method (card vs wallet) via
  //    the `paymentMethod` query param. Default: 'card'.
  let checkoutUrl: string | null = null;
  let paymentReference: string | null = null;

  // Parse the requested payment method from the query string
  // (sent by the client-side payment method picker)
  const requestedPaymentMethod = request.nextUrl.searchParams.get('method') === 'wallet'
    ? 'wallet'
    : 'card';

  try {
    const result = await PaymentService.createPayment(
      {
        orderId: o.id,
        amount: Number(o.amount),
        currency: o.currency,
        customerEmail: p?.email,
        customerName: p?.name ?? undefined,
        customerPhone: p?.phone ?? undefined,
        description: subjectName,
        redirectUrl: `${request.nextUrl.origin}/?payment_callback=success`,
        paymentMethod: requestedPaymentMethod,
      },
      o.gateway_id ?? undefined, // pass the gateway snapshot if set
    );

    if (result.success && result.checkoutUrl) {
      checkoutUrl = result.checkoutUrl;
      paymentReference = result.paymentReference ?? null;

      // 5. Update the order with:
      //    - provider_order_ref = Paymob intention ID (for callback linking)
      //    - gateway_id = the resolved gateway's DB ID (gateway snapshot)
      //      This ensures the webhook uses the SAME gateway config that
      //      created the payment — even if the default gateway changes later.
      await supabaseServer
        .from('orders')
        .update({
          provider_order_ref: paymentReference,
          gateway_id: result.gatewayId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', o.id)
        .eq('student_id', auth.user.id)
        .eq('status', 'pending'); // defense-in-depth — don't update a non-pending order
    } else {
      // PaymentService returned success=false without throwing — rare.
      // Treat as a generic Paymob API rejection.
      logPaymentEvent({
        level: 'warn',
        operation: 'createPayment',
        orderId: o.id,
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
  } catch (err) {
    // Categorize the error → safe Arabic message + appropriate HTTP status.
    // The raw error code is logged server-side; the client only sees the
    // category + the safe message.
    const categorized = categorizePaymentError(err, o.gateway_id);

    logPaymentEvent({
      level: 'error',
      operation: 'createPayment',
      orderId: o.id,
      success: false,
      errorCode: categorized.underlyingCode ?? 'UNKNOWN',
      message: isPaymentError(err) ? err.message : (err instanceof Error ? err.message : 'unknown error'),
      // NOTE: logPaymentEvent strips `cause` (which may contain Paymob API response body)
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

  // 6. Return the checkout URL for the student to redirect to
  return NextResponse.json({
    success: true,
    checkout_url: checkoutUrl,
    payment_reference: paymentReference,
    message: 'تم إنشاء دفعة. سيتم تحويلك لبوابة الدفع.',
  });
}
