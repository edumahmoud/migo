import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/teacher/subscriptions/activate
 *
 * Manually activate a pending student's subscription when the payment
 * gateway is unavailable. The teacher confirms they received payment
 * outside the system (cash, bank transfer, etc.) and activates the
 * enrollment directly.
 *
 * Body: { orderId: string }
 *
 * Validates:
 *   1. The order exists + is 'pending'
 *   2. The subject belongs to the teacher (subjects.teacher_id = auth.user.id)
 *   3. Amount + currency match
 *
 * Calls the existing activate_subscription_after_payment RPC with
 * p_confirmed_by = teacher_id (marks it as manually activated).
 *
 * Authorization: requireTeacher (teacher or admin or superadmin).
 */
const BodySchema = z.object({
  orderId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const auth = await requireTeacher(request);
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
  const teacherId = auth.user.id;

  // 1. Fetch the order + validate it belongs to a subject owned by this teacher
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

  // 2. Validate the subject belongs to the teacher
  if (!o.subjects || o.subjects.teacher_id !== teacherId) {
    return NextResponse.json({ success: false, error: 'غير مصرح — هذا المقرر لا ينتمي إليك' }, { status: 403 });
  }

  // 3. Validate status is pending
  if (o.status !== 'pending') {
    return NextResponse.json(
      { success: false, error: `حالة الطلب: ${o.status} — يمكن التفعيل اليدوي للطلبات المعلّقة فقط` },
      { status: 400 },
    );
  }

  // 4. Call the existing RPC — marks as paid + creates enrollment + financial_ledger
  const manualPaymentId = `manual_${randomUUID()}`;
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
        activated_by: teacherId,
        activated_at: new Date().toISOString(),
        reason: 'Manual activation by teacher (payment gateway unavailable)',
      },
      p_confirmed_by: teacherId,
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
