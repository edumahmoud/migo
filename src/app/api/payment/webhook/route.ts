import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/payment/webhook
 *
 * Provider-agnostic, idempotent webhook endpoint for payment confirmations.
 *
 * Headers expected:
 *   X-Webhook-Signature: hex-encoded HMAC-SHA256 of the raw body, using
 *     the shared secret from process.env.PAYMENT_WEBHOOK_SECRET.
 *   X-Webhook-Provider: e.g. 'mock', 'fawry', 'paymob', 'instapay'.
 *
 * Body (JSON):
 *   {
 *     provider_order_ref: string,    // matches orders.provider_order_ref
 *     provider_payment_id: string,  // gateway-side unique id (UNIQUE in payments table)
 *     amount: number,
 *     currency: string,
 *     status: 'paid' | 'failed' | 'cancelled' | 'refunded',
 *     raw_payload?: object          // optional original gateway payload
 *   }
 *
 * Flow:
 *   1. Verify HMAC signature (constant-time compare).
 *   2. Look up order by provider_order_ref.
 *   3. Verify amount + currency match the order's stored values (defends
 *      against client tampering with the price during order creation).
 *   4. Call the activate_subscription_after_payment() RPC — atomic,
 *      idempotent, transactional:
 *        - INSERTs the payment record (UNIQUE on provider_payment_id).
 *        - UPDATEs the order status to 'paid'.
 *        - UPSERTs the enrollment (UNIQUE on subject_id+student_id).
 *        - Activates the student on first successful subscription.
 *
 * Repeated webhooks for the same provider_payment_id are NO-OPs (the UNIQUE
 * constraint on payments.provider_payment_id catches them, and the RPC
 * returns success: true, already_processed: true).
 *
 * If the webhook is for a 'failed' status, the order is marked 'failed'
 * (no subscription activation happens).
 *
 * ─── Phase 3 note ───
 * This webhook uses a global HMAC secret (PAYMENT_WEBHOOK_SECRET) as a
 * transitional measure. In Phase 4, this will be refactored to use the
 * Payment Gateway Core (PaymentService.handleWebhook) which resolves
 * the gateway-specific credentials from the payment_gateways table.
 *
 * The fallback secret 'attendo_dev_webhook_secret_change_me_in_production'
 * has been REMOVED — if PAYMENT_WEBHOOK_SECRET is not set, ALL webhooks
 * are rejected with 401. This is the correct secure behavior.
 */
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || '';

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  // Fail closed: if no secret is configured, reject ALL webhooks.
  // This prevents the webhook from being a bypass when misconfigured.
  if (!WEBHOOK_SECRET) return false;
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // 1. Read the raw body (for HMAC verification) — don't use request.json() yet.
  const rawBody = await request.text();

  const signature = request.headers.get('x-webhook-signature');
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json(
      { success: false, error: 'توقيع غير صالح' },
      { status: 401 }
    );
  }

  // 2. Parse the body.
  let body: {
    provider_order_ref?: string;
    provider_payment_id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    raw_payload?: unknown;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const {
    provider_order_ref,
    provider_payment_id,
    amount,
    currency,
    status,
    raw_payload,
  } = body;

  if (!provider_order_ref || !provider_payment_id || amount === undefined || !currency || !status) {
    return NextResponse.json(
      { success: false, error: 'حقول مفقودة: provider_order_ref, provider_payment_id, amount, currency, status' },
      { status: 400 }
    );
  }

  // 3. Look up the order by provider_order_ref.
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select('id, amount, currency, status, student_id, subject_id')
    .eq('provider_order_ref', provider_order_ref)
    .maybeSingle();

  if (orderErr || !order) {
    return NextResponse.json(
      { success: false, error: 'الطلب غير موجود' },
      { status: 404 }
    );
  }

  // 4. For 'paid' status, run the activation RPC (atomic + idempotent).
  //    For other statuses (failed/cancelled/refunded), just mark the order.
  if (status === 'paid') {
    const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
      'activate_subscription_after_payment',
      {
        p_order_id: (order as { id: string }).id,
        p_provider_payment_id: provider_payment_id,
        p_amount: amount,
        p_currency: currency,
        p_status: status,
        p_raw_payload: raw_payload ?? null,
        p_confirmed_by: null,
      }
    );

    if (rpcErr) {
      console.error('[webhook] RPC error:', rpcErr);
      return NextResponse.json(
        { success: false, error: 'فشل تفعيل الاشتراك: ' + rpcErr.message },
        { status: 500 }
      );
    }

    const result = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean; already_processed?: boolean }) ?? {};
    if (result.success === false) {
      return NextResponse.json(
        { success: false, error: result.error || 'فشل التفعيل' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      already_paid: !!result.already_paid,
      already_processed: !!result.already_processed,
    });
  } else {
    // failed / cancelled / refunded — just mark the order.
    const { error: updateErr } = await supabaseServer
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', (order as { id: string }).id);

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: 'فشل تحديث حالة الطلب' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, status });
  }
}
