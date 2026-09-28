import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/subscriptions/activate
 *
 * Manually activate a pending student's subscription when the payment
 * gateway is unavailable. The agent confirms they received payment
 * outside the system (cash, bank transfer, etc.) and activates the
 * enrollment directly.
 *
 * Body: { orderId: string }
 *
 * Mirrors /api/teacher/subscriptions/activate but checks the order
 * belongs to a subject owned by the AGENT's teacher (sourceTeacherId)
 * rather than the caller themselves being the teacher.
 *
 * Authorization:
 *   - Caller must be a registration_agent
 *   - The order's subject must belong to the agent's teacher
 *
 * Validation:
 *   - Order status must be 'pending'
 *
 * Calls the same activate_subscription_after_payment RPC with
 * p_confirmed_by = agent_id (marks it as manually activated by agent).
 */

const BodySchema = z.object({
  orderId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'orderId مطلوب (UUID صالح)' }, { status: 400 });
  }

  const orderId = parsed.data.orderId;
  const agentId = auth.user.id;
  const { sourceTeacherId } = auth;

  // 1. Fetch the order + verify subject ownership
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      subjects:subject_id (teacher_id)
    `)
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
  }

  const o = order as unknown as {
    id: string; student_id: string; subject_id: string;
    amount: number; currency: string; status: string;
    subjects: { teacher_id: string } | null;
  };

  // 2. Validate the subject belongs to the agent's teacher
  if (!o.subjects || o.subjects.teacher_id !== sourceTeacherId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — هذا المقرر لا ينتمي إلى معلمك' },
      { status: 403 },
    );
  }

  // 3. Validate status is pending
  if (o.status !== 'pending') {
    return NextResponse.json(
      { success: false, error: `حالة الطلب: ${o.status} — يمكن التفعيل اليدوي للطلبات المعلّقة فقط` },
      { status: 400 },
    );
  }

  // 4. Call the existing RPC — marks as paid + creates enrollment + financial_ledger
  const manualPaymentId = `manual_agent_${randomUUID()}`;
  const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
    'activate_subscription_after_payment',
    {
      p_order_id: orderId,
      p_provider_payment_id: manualPaymentId,
      p_amount: Number(o.amount),
      p_currency: o.currency,
      p_status: 'paid',
      p_raw_payload: {
        manual_activation: true,
        activated_by: agentId,
        activated_by_role: 'registration_agent',
        activated_at: new Date().toISOString(),
        reason: 'Manual activation by registration agent (payment received outside system)',
      },
      p_confirmed_by: agentId,
    },
  );

  if (rpcErr) {
    return NextResponse.json({ success: false, error: rpcErr.message }, { status: 500 });
  }

  const result = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
  if (result.success === false) {
    return NextResponse.json(
      { success: false, error: result.error || 'فشل التفعيل' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    order_id: orderId,
    message: result.already_paid ? 'الطلب مُفعّل بالفعل' : 'تم تفعيل الاشتراك يدويًا',
  });
}
