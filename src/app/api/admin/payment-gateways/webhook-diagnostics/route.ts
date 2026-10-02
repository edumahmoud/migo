import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/admin/payment-gateways/webhook-diagnostics
 *
 * Returns diagnostic info to help debug webhook issues:
 *   1. The default gateway's notification_url (where Paymob SHOULD
 *      send the webhook)
 *   2. Recent orders (last 20) — shows which orders are 'pending'
 *      and which are 'paid' (the paid ones confirm the webhook
 *      worked)
 *   3. Instructions on how to configure the webhook in Paymob Dashboard
 *
 * Admin-only.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  // 1. Get the default gateway (with decrypted configuration)
  const { data: gateway, error: gatewayErr } = await supabaseServer
    .from('payment_gateways')
    .select('id, provider, display_name, environment, is_enabled, is_default, configuration_encrypted')
    .eq('is_default', true)
    .maybeSingle();

  // 2. Get recent orders to see if any have been activated
  const { data: orders, error: ordersErr } = await supabaseServer
    .from('orders')
    .select('id, status, amount, currency, created_at, paid_at, activated_at, gateway_id, provider_order_ref, subject:subject_id(name), student:student_id(email, name)')
    .order('created_at', { ascending: false })
    .limit(20);

  // 3. Compile the diagnostic info
  const diagnostics = {
    defaultGateway: gateway
      ? {
          id: (gateway as { id: string }).id,
          provider: (gateway as { provider: string }).provider,
          displayName: (gateway as { display_name: string }).display_name,
          environment: (gateway as { environment: string }).environment,
          isEnabled: (gateway as { is_enabled: boolean }).is_enabled,
          // NOTE: configuration_encrypted is encrypted; we can't read
          // the notification_url directly here without the decryption
          // key. The admin should check the admin UI for the actual
          // notification_url value.
          configurationNote: 'Check the admin UI for the notification_url value (it\'s decrypted there)',
        }
      : null,
    gatewayError: gatewayErr?.message ?? null,

    recentOrders: (orders ?? []).map((o: Record<string, unknown>) => ({
      id: o.id,
      status: o.status,
      amount: Number(o.amount),
      currency: o.currency,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      activatedAt: o.activated_at,
      gatewayId: o.gateway_id,
      providerOrderRef: o.provider_order_ref,
      subjectName: (o.subject as { name?: string } | null)?.name ?? null,
      studentEmail: (o.student as { email?: string } | null)?.email ?? null,
    })),
    ordersError: ordersErr?.message ?? null,

    // ── Configuration checklist for the admin ──
    checklist: {
      step1: 'الكود بيبعت notification_url مع كل عملية دفع — مفيش حاجة محتاجة تتعمل في Paymob Dashboard للـ webhook',
      step2: 'لو الـ webhook لسه مش بيوصل بعد الإصلاح ده، اتأكد إن:',
      step2a: '  - الـ notification_url في الـ admin panel = https://YOURDOMAIN.com/api/payment/webhook?provider=paymob',
      step2b: '  - الـ gateway_id بيضاف كـ query param تلقائياً',
      step3: 'لو عايز تأكد إن Paymob مظبوط يبعت webhook بشكل عام:',
      step3a: '  - ادخل https://accept.paymob.com/portal2/en/login',
      step3b: '  - روح لـ Settings (في الـ sidebar على اليمين)',
      step3c: '  - روح لـ Account Info → هناك بتلاقي حقل الـ Webhook URL/HMAC',
      step4: 'تأكد إن HMAC Secret في الـ admin panel = HMAC في Paymob Dashboard',
      step5: 'اعمل دفعة اختبار جديدة بعد ما Vercel يخلص deploy — الكود دلوقتي بيبعت notification_url تلقائياً',
      step6: 'بعد الدفعة، شوف Vercel logs على prefix [webhook:debug] — لو مش موجود، الـ webhook لسه مش بيوصل',
    },

    // ── Common issues ──
    commonIssues: [
      {
        issue: 'Webhook مش بيوصل خالص',
        cause: 'Paymob Dashboard مش مظبوط يبعت webhook للـ URL بتاعنا',
        fix: 'اضف الـ webhook URL في Paymob Dashboard → Settings → Webhooks',
      },
      {
        issue: 'Webhook بيوصل بس HMAC بفشل',
        cause: 'الـ HMAC Secret في الـ admin panel مش نفسه في Paymob Dashboard',
        fix: 'اتأكد إن الـ HMAC Secret متطابق في الجانبين',
      },
      {
        issue: 'Webhook بيوصل بس order not found',
        cause: 'الـ merchant_order_id اللي بيبعته Paymob مش بيعرض أي order في الـ DB',
        fix: 'اتأكد إن الـ order_id في الـ webhook = الـ order UUID في جدول orders',
      },
      {
        issue: 'Order found بس status مش بيتحدّث',
        cause: 'الـ RPC activate_subscription_after_payment بيرجع error',
        fix: 'شوف الـ server logs لو فيه error message من الـ RPC',
      },
    ],
  };

  return NextResponse.json({
    success: true,
    diagnostics,
  });
}
