import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

/**
 * POST /api/payment/mock-pay
 *
 * MOCK GATEWAY — DEV/TESTING ONLY.
 *
 * Simulates a successful payment by calling the trusted webhook endpoint
 * (/api/payment/webhook) with an HMAC-signed payload. This is the ONLY
 * thing that would differ in production — the real gateway would call
 * the webhook directly after a successful payment.
 *
 * Guards (v69 security hardening):
 *   1. PAYMENT_MOCK_ENABLED env var must be 'true' (default false in production).
 *   2. Auth required (cookie or Bearer token).
 *   3. Order must exist + be owned by the authenticated user.
 *   4. Order must be in 'pending' status (no re-paying paid orders).
 *   5. Order must have confirmation_mode='automatic' (no manual-mode mocking).
 *   6. The amount/currency sent to the webhook are read from the DB — never
 *      from the client. The webhook's RPC verifies them again.
 *
 * Idempotency:
 *   - If the order is already 'paid' (e.g. double-click), return success
 *     without calling the webhook.
 *   - The webhook's RPC uses SELECT FOR UPDATE + UNIQUE on provider_payment_id
 *     to handle concurrent requests safely.
 *
 * Form body: { order_id: string }
 */
const MOCK_ENABLED = process.env.PAYMENT_MOCK_ENABLED === 'true' ||
  process.env.NODE_ENV === 'development';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'attendo_dev_webhook_secret_change_me_in_production';

export async function POST(request: NextRequest) {
  // 1. Env guard — block in production unless explicitly enabled.
  if (!MOCK_ENABLED) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // 2. Auth required.
  const auth = await authenticateRequest(request);
  if (!auth.success) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const formData = await request.formData();
  const orderId = formData.get('order_id') as string | null;
  if (!orderId) {
    return new NextResponse('Missing order_id', { status: 400 });
  }

  // 3. Fetch the order with all security-relevant fields.
  const { data: order, error } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, provider, provider_order_ref, status, confirmation_mode')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return new NextResponse('Order not found', { status: 404 });
  }

  const o = order as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    provider: string;
    provider_order_ref: string;
    status: string;
    confirmation_mode: string;
  };

  // 4. Ownership check — student A cannot pay student B's order.
  if (o.student_id !== auth.user.id) {
    return new NextResponse('Forbidden: order does not belong to authenticated user', { status: 403 });
  }

  // 5. Status check — only pending orders can be paid.
  if (o.status === 'paid') {
    return new NextResponse(
      `<!doctype html><html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>✓ تم الدفع مسبقاً</h1>
        <p>هذا الطلب مدفوع بالفعل. سيتم تحويلك إلى لوحتك...</p>
        <script>setTimeout(() => { window.location.href = '/'; }, 2000);</script>
      </body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
  if (o.status !== 'pending') {
    return new NextResponse(`Order is ${o.status}. Cannot process payment.`, { status: 400 });
  }

  // 6. Confirmation mode check — mock only handles automatic-mode orders.
  if (o.confirmation_mode !== 'automatic') {
    return new NextResponse(
      'This order requires manual payment confirmation (Fawry/InstaPay/cash). Mock gateway cannot process it.',
      { status: 400 }
    );
  }

  // 7. Build the webhook payload. CRITICAL: amount + currency are read from
  //    the DB (server-side source of truth) — never from the client.
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
      order_id: o.id,
    },
  };

  const payloadStr = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(payloadStr).digest('hex');

  // 8. Call the webhook internally (HMAC-signed — same as a real gateway).
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

  // 9. Show the result page.
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
