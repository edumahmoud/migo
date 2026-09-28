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
      step1: 'ادخل على Paymob Dashboard (https://accept.paymob.com)',
      step2: 'روح لـ Settings → Webhooks (أو Developer Settings → Webhooks)',
      step3: 'ضيف Webhook URL جديد بالشكل ده:',
      webhookUrlFormat: 'https://YOURDOMAIN.com/api/payment/webhook?provider=paymob&gateway_id=YOUR_GATEWAY_ID',
      step4: 'في الـ admin panel، افتح Payment Gateways → عدّل الـ default gateway → شوف قيمة الـ Webhook URL (notification_url) — لازم تكون نفس اللي فوق',
      step5: 'تأكد إن الـ HMAC Secret في الـ admin panel = الـ HMAC Secret في Paymob Dashboard',
      step6: 'بعد ما تضيف الـ webhook في Paymob، اعمل دفعة اختبار جديدة — Paymob هت试用 الـ webhook',
      step7: 'بعد الدفعة، شوف Vercel logs على الكوماند console.error prefix [webhook:debug] — لو مش موجود، الـ webhook مش بيوصل',
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
