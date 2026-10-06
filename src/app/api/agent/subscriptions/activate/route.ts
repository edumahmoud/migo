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
  //    v116: also fetch plan_id + plan_duration_days so the activation
  //    RPC uses the plan's actual duration (e.g., 365 for yearly)
  //    instead of the hardcoded 30-day default.
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      plan_id, plan_duration_days,
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
    plan_id: string | null;
    plan_duration_days: number | null;
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
  //    v116: pass plan_duration_days so the RPC uses the plan's actual
  //    duration (e.g., 365 for yearly) instead of the hardcoded 30-day
  //    default. The RPC also reads plan_duration_days from the order
  //    row directly as a fallback (in case the caller forgets to pass it).
  const manualPaymentId = `manual_agent_${randomUUID()}`;
  const periodDays = o.plan_duration_days ?? 30;
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
      p_period_days: periodDays,
    },
  );

  if (rpcErr) {
    // ── FALLBACK: RPC failed — directly insert the enrollment ──
    console.error('[agent:activate] RPC failed — falling back to direct insert', {
      orderId,
      error: rpcErr.message,
    });

    const now = new Date().toISOString();

    // Mark order as paid
    await supabaseServer
      .from('orders')
      .update({
        status: 'paid',
        paid_at: now,
        activated_at: now,
        updated_at: now,
      })
      .eq('id', orderId)
      .eq('status', 'pending');

    // UPSERT enrollment
    const { error: enrollErr } = await supabaseServer
      .from('subject_students')
      .upsert({
        subject_id: o.subject_id,
        student_id: o.student_id,
        status: 'approved',
        enrollment_method: 'self_paid',
        enrolled_at: now,
        monthly_price: Number(o.amount),
        current_period_start: now,
        current_period_end: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
        next_billing_at: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'subject_id,student_id',
      });

    if (enrollErr) {
      return NextResponse.json(
        { success: false, error: `RPC failed AND fallback failed: ${enrollErr.message}` },
        { status: 500 },
      );
    }

    // Activate student account
    await supabaseServer
      .from('users')
      .update({ account_status: 'active', updated_at: now })
      .eq('id', o.student_id)
      .in('account_status', ['pending', 'pending_verification', null]);

    // Insert payment record (best effort)
    await supabaseServer
      .from('payments')
      .insert({
        order_id: orderId,
        provider_payment_id: manualPaymentId,
        amount: Number(o.amount),
        currency: o.currency,
        status: 'paid',
        raw_payload: {
          manual_activation: true,
          fallback: true,
          activated_by: agentId,
          activated_by_role: 'registration_agent',
          reason: 'Manual activation by agent — RPC fallback',
        },
        confirmed_by: agentId,
      })
      .then(({ error }) => {
        if (error) console.warn('[agent:activate] payment insert failed', error.message);
      });

    return NextResponse.json({
      success: true,
      order_id: orderId,
      message: 'تم تفعيل الاشتراك يدويًا (fallback path)',
    });
  }

  const result = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
  if (result.success === false) {
    return NextResponse.json(
      { success: false, error: result.error || 'فشل التفعيل' },
      { status: 400 },
    );
  }

  // ── VERIFY the enrollment was actually created ──
  const { data: verifyEnrollment } = await supabaseServer
    .from('subject_students')
    .select('id, status')
    .eq('subject_id', o.subject_id)
    .eq('student_id', o.student_id)
    .maybeSingle();

  if (!verifyEnrollment || (verifyEnrollment as { status: string }).status !== 'approved') {
    console.error('[agent:activate] RPC succeeded but enrollment missing — fallback', {
      orderId,
    });

    const now = new Date().toISOString();
    const { error: enrollErr } = await supabaseServer
      .from('subject_students')
      .upsert({
        subject_id: o.subject_id,
        student_id: o.student_id,
        status: 'approved',
        enrollment_method: 'self_paid',
        enrolled_at: now,
        monthly_price: Number(o.amount),
        current_period_start: now,
        current_period_end: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
        next_billing_at: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'subject_id,student_id',
      });

    if (enrollErr) {
      return NextResponse.json(
        { success: false, error: `Enrollment creation failed: ${enrollErr.message}` },
        { status: 500 },
      );
    }

    await supabaseServer
      .from('users')
      .update({ account_status: 'active', updated_at: now })
      .eq('id', o.student_id)
      .in('account_status', ['pending', 'pending_verification', null]);
  }

  return NextResponse.json({
    success: true,
    order_id: orderId,
    message: result.already_paid ? 'الطلب مُفعّل بالفعل' : 'تم تفعيل الاشتراك يدويًا',
  });
}
