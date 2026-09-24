import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/payment/mock-checkout?order_id=...
 *
 * Renders a simple HTML mock checkout page. Used in dev/testing to simulate
 * the payment gateway redirect. The student clicks "Pay" → form submits to
 * /api/payment/mock-pay which simulates the gateway processing and internally
 * calls /api/payment/webhook with an HMAC-signed payload.
 *
 * In production, this route is replaced by the real gateway's hosted checkout
 * (Paymob/Fawry/InstaPay). The webhook contract is identical.
 */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('order_id');
  if (!orderId) {
    return new NextResponse('Missing order_id', { status: 400 });
  }

  // Fetch the order (no auth — the order_id itself is the unguessable secret).
  const { data: order } = await supabaseServer
    .from('orders')
    .select('id, amount, currency, provider, status, subject_id, subject:subjects!inner(name)')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    return new NextResponse('Order not found', { status: 404 });
  }

  const o = order as unknown as {
    id: string;
    amount: number;
    currency: string;
    provider: string;
    status: string;
    subject_id: string;
    subject: { name: string } | null;
  };

  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8"/>
<title>صفحة دفع تجريبية</title>
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
    <p class="note">هذه صفحة دفع وهمية لأغراض التطوير. عند الضغط على الزر، سيتم استدعاء الـ webhook لتأكيد الدفع وتفعيل الاشتراك. في الإنتاج، تستبدل بصفحة بوابة الدفع الحقيقية.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
