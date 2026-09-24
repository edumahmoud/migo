import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

/**
 * GET /api/payment/mock-checkout?order_id=...
 *
 * MOCK GATEWAY — DEV/TESTING ONLY.
 *
 * Guards (v69 security hardening):
 *   1. PAYMENT_MOCK_ENABLED env var must be 'true' (default false in production).
 *   2. Auth required (cookie or Bearer token).
 *   3. Order must exist + be owned by the authenticated user (student_id = auth.uid).
 *   4. Order must be in 'pending' status (no checkout for paid/failed orders).
 *   5. Order must have confirmation_mode='automatic' (don't mock manual-mode orders).
 *
 * Opening this URL NEVER activates a subscription — it only renders a static
 * HTML page. Activation happens only when the student clicks the "Pay" button
 * which posts to /api/payment/mock-pay (which then calls the trusted webhook
 * with HMAC-signed payload).
 *
 * In production, this route returns 404 — replace with the real gateway's
 * hosted checkout URL (Paymob/Fawry). The webhook contract stays the same.
 */
const MOCK_ENABLED = process.env.PAYMENT_MOCK_ENABLED === 'true' ||
  process.env.NODE_ENV === 'development';

export async function GET(request: NextRequest) {
  // 1. Env guard — block in production unless explicitly enabled.
  if (!MOCK_ENABLED) {
    return new NextResponse('Not Found', { status: 404 });
  }

  // 2. Auth required.
  const auth = await authenticateRequest(request);
  if (!auth.success) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const orderId = request.nextUrl.searchParams.get('order_id');
  if (!orderId) {
    return new NextResponse('Missing order_id', { status: 400 });
  }

  // 3. Fetch the order.
  const { data: order, error } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, provider, status, confirmation_mode, subject:subjects!inner(name)')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return new NextResponse('Order not found', { status: 404 });
  }

  const o = order as unknown as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    provider: string;
    status: string;
    confirmation_mode: string;
    subject: { name: string } | null;
  };

  // 4. Ownership check — student can only view their own orders.
  if (o.student_id !== auth.user.id) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // 5. Status check — paid/failed/cancelled orders can't be re-checked-out.
  if (o.status !== 'pending') {
    return new NextResponse(
      `Order is ${o.status}. Cannot open checkout for non-pending orders.`,
      { status: 400 }
    );
  }

  // 6. Confirmation mode check — don't allow mock to process manual-mode orders.
  if (o.confirmation_mode !== 'automatic') {
    return new NextResponse(
      'This order requires manual payment confirmation (Fawry/InstaPay/cash). Mock gateway cannot process it.',
      { status: 400 }
    );
  }

  // Render the mock checkout HTML.
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8"/>
<title>صفحة دفع تجريبية (Mock)</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  body { font-family: system-ui, sans-serif; background: #f8fafc; padding: 24px; color: #0f172a; }
  .card { max-width: 420px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
  .row:last-of-type { border-bottom: none; }
  .amount { font-size: 28px; font-weight: 700; text-align: center; margin: 16px 0; color: #059669; }
  button { width: 100%; padding: 12px; background: #0ea5e9; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
  button:hover { background: #0284c7; }
  .note { font-size: 11px; color: #64748b; text-align: center; margin-top: 12px; }
  .badge { display: inline-block; padding: 2px 8px; background: #fef3c7; color: #92400e; border-radius: 4px; font-size: 11px; }
</style>
</head>
<body>
  <div class="card">
    <h1>صفحة دفع تجريبية (Mock Gateway)</h1>
    <div class="row"><span>المقرر:</span><strong>${o.subject?.name ?? '—'}</strong></div>
    <div class="row"><span>رقم الطلب:</span><code dir="ltr">${o.id}</code></div>
    <div class="row"><span>المزود:</span><span class="badge">${o.provider}</span></div>
    <div class="row"><span>حالة الطلب:</span><span>${o.status}</span></div>
    <div class="amount">${Number(o.amount).toFixed(2)} ${o.currency}</div>
    <form method="POST" action="/api/payment/mock-pay">
      <input type="hidden" name="order_id" value="${o.id}"/>
      <button type="submit">دفع الآن (محاكاة نجاح الدفع)</button>
    </form>
    <p class="note">⚠️ بوابة تجريبية للتطوير فقط. عند الضغط على الزر، يتم استدعاء الـ webhook الموقّع بتوقيع HMAC لتأكيد الدفع وتفعيل الاشتراك. في الإنتاج، تستبدل ببوابة الدفع الحقيقية.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
