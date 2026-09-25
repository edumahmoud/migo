import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/orders/[id]/submit-proof
 *
 * Submits proof-of-payment for a manual-confirmation order.
 * After the student transfers money externally (Vodafone Cash,
 * InstaPay, bank transfer), they submit:
 *   - sender_name: name on the sender's account
 *   - transaction_ref: transaction ID / reference
 *   - proof_notes: optional free-text notes
 *
 * The order's status stays 'pending' — the supervisor must still
 * approve it. But the proof fields are populated so the supervisor
 * can match the payment.
 *
 * Authorization: only the order's owner (student_id = auth.uid()).
 * Order must be in 'pending' status with confirmation_mode='manual'.
 */
const BodySchema = z.object({
  sender_name: z.string().trim().min(1).max(200),
  transaction_ref: z.string().trim().min(1).max(200),
  proof_notes: z.string().trim().max(1000).optional(),
});

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: orderId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة: ' + parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  // 1. Fetch the order to verify ownership + status.
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, status, confirmation_mode, amount, currency, sender_name')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr) {
    return NextResponse.json({ success: false, error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
  }

  const o = order as { id: string; student_id: string; status: string; confirmation_mode: string; amount: number; currency: string; sender_name: string | null };
  if (o.student_id !== auth.user.id) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }
  if (o.status !== 'pending') {
    return NextResponse.json(
      { success: false, error: `لا يمكن تقديم إثبات لطلب بحالة: ${o.status}` },
      { status: 400 }
    );
  }
  if (o.confirmation_mode !== 'manual') {
    return NextResponse.json(
      { success: false, error: 'هذا الطلب لا يتطلب إثبات دفع (الدفع تلقائي)' },
      { status: 400 }
    );
  }

  // 2. Update the order with proof data.
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({
      sender_name: parsed.data.sender_name,
      transaction_ref: parsed.data.transaction_ref,
      proof_notes: parsed.data.proof_notes ?? null,
      proof_submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('student_id', auth.user.id); // extra safety

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: 'تم إرسال إثبات الدفع بنجاح. سيقوم المشرف بمراجعة الدفع وتفعيل الاشتراك خلال وقت قصير.',
  });
}
