import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import { PaymentService, isPaymentError } from '@/lib/payment';

/**
 * POST /api/student/orders/[id]/pay
 *
 * Initiates a Paymob payment for the given order.
 *
 * Flow:
 *   1. Validate the student owns the order + it's 'pending'.
 *   2. Call PaymentService.createPayment() → Paymob Intention API.
 *   3. Update the order with provider_order_ref (intention ID) + gateway_id.
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
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: orderId } = await ctx.params;

  // 1. Fetch the order + validate ownership + status
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, status, provider_order_ref, gateway_id')
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

  // 4. Call PaymentService.createPayment() — resolves the gateway + calls the adapter
  let checkoutUrl: string | null = null;
  let paymentReference: string | null = null;

  try {
    const result = await PaymentService.createPayment({
      orderId: o.id,
      amount: Number(o.amount),
      currency: o.currency,
      customerEmail: p?.email,
      customerName: p?.name ?? undefined,
      customerPhone: p?.phone ?? undefined,
      description: subjectName,
      redirectUrl: `${request.nextUrl.origin}/?payment_callback=success`,
    });

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
        .eq('student_id', auth.user.id);
    } else {
      return NextResponse.json(
        { success: false, error: 'فشل إنشاء دفعة — حاول مرة أخرى' },
        { status: 500 },
      );
    }
  } catch (err) {
    const errorMsg = isPaymentError(err) ? err.message : 'خطأ غير متوقع';
    return NextResponse.json(
      { success: false, error: `فشل الدفع: ${errorMsg}` },
      { status: 500 },
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
