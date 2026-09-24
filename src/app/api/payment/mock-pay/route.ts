import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/payment/mock-pay
 *
 * Mock gateway endpoint that simulates a successful payment and calls the
 * trusted webhook endpoint (/api/payment/webhook) with an HMAC-signed
 * payload. This is the only thing that would be different in production —
 * instead of this mock, the real gateway (Paymob/Fawry/InstaPay) would
 * call /api/payment/webhook directly after a successful payment.
 *
 * Form body: { order_id: string }
 *
 * Flow:
 *   1. Look up the order + verify it's still 'pending'.
 *   2. Generate a fake provider_payment_id.
 *   3. Build the webhook payload (provider_order_ref, amount, currency, status='paid').
 *   4. Sign with HMAC-SHA256 (PAYMENT_WEBHOOK_SECRET).
 *   5. Internally call /api/payment/webhook (via fetch to localhost) OR
 *      call the RPC directly.
 *
 * For the cleanest demo, this route calls the webhook endpoint directly via
 * fetch — showing that the activation logic lives in the webhook, not in
 * the gateway redirect.
 */
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'attendo_dev_webhook_secret_change_me_in_production';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const orderId = formData.get('order_id') as string | null;
  if (!orderId) {
    return new NextResponse('Missing order_id', { status: 400 });
  }

  // 1. Fetch the order.
  const { data: order, error } = await supabaseServer
    .from('orders')
    .select('id, amount, currency, provider, provider_order_ref, status, student_id, subject_id')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return new NextResponse('Order not found', { status: 404 });
  }

  const o = order as {
    id: string;
    amount: number;
    currency: string;
    provider: string;
    provider_order_ref: string;
    status: string;
    student_id: string;
    subject_id: string;
  };

  if (o.status === 'paid') {
    return new NextResponse(
      `<html><body dir="rtl"><p style="text-align:center;font-family:sans-serif;margin-top:40px">تم الدفع مسبقاً. سيتم تحويلك إلى لوحتك...</p><meta http-equiv="refresh" content="2;url=/"/></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  // 2. Build the webhook payload.
  const providerPaymentId = `mockpay_${randomUUID()}`;
  const payload = {
    provider_order_ref: o.provider_order_ref,
    provider_payment_id: providerPaymentId,
    amount: Number(o.amount),
    currency: o.currency,
    status: 'paid',
    raw_payload: {
      mock: true,
      paid_at: new Date().toISOString(),
      student_id: o.student_id,
      subject_id: o.subject_id,
    },
  };

  const payloadStr = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');

  // 3. Call the webhook internally.
  const baseUrl = request.nextUrl.origin;
  const webhookRes = await fetch(`${baseUrl}/api/payment/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-provider': o.provider,
    },
    body: payloadStr,
  });

  const webhookJson = await webhookRes.json();

  // 4. Show a success page that redirects to the activation page.
  if (webhookJson.success) {
    return new NextResponse(
      `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>تم الدفع بنجاح</title><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
        body { font-family: system-ui, sans-serif; background: #f0fdf4; color: #065f46; padding: 24px; text-align: center; }
        .card { max-width: 480px; margin: 60px auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
        .check { font-size: 48px; color: #10b981; }
        h1 { font-size: 20px; margin: 16px 0; }
        p { color: #475569; font-size: 14px; }
      </style></head><body>
        <div class="card">
          <div class="check">✓</div>
          <h1>تم الدفع بنجاح</h1>
          <p>تم تفعيل اشتراكك في المقرر. سيتم فتح المنصة...</p>
        </div>
        <script>setTimeout(() => { window.location.href = '/'; }, 2000);</script>
      </body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  return new NextResponse(
    `<!doctype html><html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h1>فشل التفعيل</h1>
      <p>${webhookJson.error || 'خطأ غير معروف'}</p>
    </body></html>`,
    { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
