import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/admin/approve-manual-payment
 *
 * Admin endpoint to manually approve a payment for orders with
 * confirmation_mode='manual' (Fawry, InstaPay, cash — where there's no
 * automatic webhook). The admin provides the order_id + a unique
 * provider_payment_id (e.g. the Fawry reference number or InstaPay
 * transaction ID). The server then calls the same
 * activate_subscription_after_payment() RPC used by the automatic webhook,
 * keeping both flows consistent.
 *
 * Body: { orderId: UUID, providerPaymentId: string, amount?: number (optional — defaults to order.amount) }
 *
 * Auth: admin/superadmin only.
 */
const BodySchema = z.object({
  orderId: z.string().uuid(),
  providerPaymentId: z.string().trim().min(1).max(200),
  amount: z.number().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 1. Fetch the order + verify it's a manual-confirmation order.
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, status, confirmation_mode, payment_method_id')
    .eq('id', parsed.data.orderId)
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
    confirmation_mode: 'automatic' | 'manual';
    payment_method_id: string | null;
  };

  // Defense: even if an admin tries to approve an automatic-mode order, refuse —
  // those orders MUST be confirmed via the webhook (don't allow admin to bypass).
  if (o.confirmation_mode !== 'manual') {
    return NextResponse.json(
      { success: false, error: 'هذا الطلب يستخدم تأكيد تلقائي (بوابة). لا يمكن للمسؤول الموافقة عليه يدوياً.' },
      { status: 400 }
    );
  }

  const amount = parsed.data.amount ?? Number(o.amount);

  // 2. Call the same RPC the webhook uses (idempotent).
  const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
    'activate_subscription_after_payment',
    {
      p_order_id: o.id,
      p_provider_payment_id: parsed.data.providerPaymentId,
      p_amount: amount,
      p_currency: o.currency,
      p_status: 'paid',
      p_raw_payload: {
        manual_approval: true,
        approved_by: auth.user.id,
        approved_at: new Date().toISOString(),
      },
      p_confirmed_by: auth.user.id,
    }
  );

  if (rpcErr) {
    return NextResponse.json(
      { success: false, error: 'فشل التفعيل: ' + rpcErr.message },
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
    order_id: o.id,
  });
}

// Helper export for tests.
export const _internal = { generateProviderPaymentId: () => `manual_${randomUUID()}` };
