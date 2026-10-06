import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
// v112: per-teacher commission resolver + v88 fees-on-top split helper
import { getEffectiveCommissionRate, calculateSharesFromOrderFees, OrderFeesSnapshotError } from '@/lib/payment/commission';

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
  //    v112: include base_amount + grand_total for v88 split computation.
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      base_amount, fees_total, grand_total,
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
    // v112: v88 fees-on-top columns (NULL for pre-v88 orders)
    base_amount: number | null;
    fees_total: number | null;
    grand_total: number | null;
    // v116: plan snapshot for the activation RPC + fallback UPSERT.
    plan_id: string | null;
    plan_duration_days: number | null;
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
  //    v116: pass plan_duration_days so the RPC uses the plan's actual
  //    duration (e.g., 365 for yearly) instead of the hardcoded 30-day
  //    default. The RPC also reads plan_duration_days from the order
  //    row directly as a fallback.
  const manualPaymentId = `manual_${randomUUID()}`;
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
        activated_by: teacherId,
        activated_at: new Date().toISOString(),
        reason: 'Manual activation by teacher (payment gateway unavailable)',
      },
      p_confirmed_by: teacherId,
      p_period_days: periodDays,
    },
  );

  if (rpcErr) {
    // ── FALLBACK: RPC failed — directly insert the enrollment ──
    // This happens when the RPC has issues (missing columns, etc.)
    // We bypass the RPC and do the work directly:
    //   1. Mark order as paid
    //   2. UPSERT subject_students enrollment
    //   3. Activate student account
    console.error('[teacher:activate] RPC failed — falling back to direct insert', {
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

    // UPSERT enrollment (status='approved')
    const { error: enrollmentErr } = await supabaseServer
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

    if (enrollmentErr) {
      console.error('[teacher:activate] fallback enrollment insert failed', {
        orderId,
        error: enrollmentErr.message,
      });
      return NextResponse.json(
        { success: false, error: `RPC failed AND fallback enrollment insert failed: ${enrollmentErr.message}` },
        { status: 500 },
      );
    }

    // Activate student account (if pending)
    await supabaseServer
      .from('users')
      .update({ account_status: 'active', updated_at: now })
      .eq('id', o.student_id)
      .in('account_status', ['pending', 'pending_verification', null]);

    // Insert payment record (best effort — non-critical)
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
          activated_by: teacherId,
          reason: 'Manual activation by teacher — RPC fallback path',
        },
        confirmed_by: teacherId,
      })
      .then(({ error }) => {
        if (error) {
          console.warn('[teacher:activate] payment insert failed (non-critical)', error.message);
        }
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
      { success: false, error: result.error || 'فشل التفغيل' },
      { status: 400 },
    );
  }

  // ── VERIFY the enrollment was actually created ──
  // The RPC might return success but not create the enrollment (rare bug
  // or schema mismatch). Check + fallback to direct INSERT if needed.
  const { data: verifyEnrollment } = await supabaseServer
    .from('subject_students')
    .select('id, status')
    .eq('subject_id', o.subject_id)
    .eq('student_id', o.student_id)
    .maybeSingle();

  if (!verifyEnrollment || (verifyEnrollment as { status: string }).status !== 'approved') {
    console.error('[teacher:activate] RPC succeeded but enrollment missing/not approved — falling back to direct insert', {
      orderId,
      verifyEnrollment,
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
      console.error('[teacher:activate] verify-fallback enrollment insert failed', enrollErr);
      return NextResponse.json(
        { success: false, error: `Enrollment creation failed: ${enrollErr.message}` },
        { status: 500 },
      );
    }

    // Also activate student account (if pending)
    await supabaseServer
      .from('users')
      .update({ account_status: 'active', updated_at: now })
      .eq('id', o.student_id)
      .in('account_status', ['pending', 'pending_verification', null]);

    // ── Also create payments + financial_ledger (verify-fallback path) ──
    // This ensures the teacher's revenue stats include this activation.
    const verifyPaymentId = `verify_${orderId}`;
    await supabaseServer
      .from('payments')
      .insert({
        order_id: orderId,
        provider_payment_id: verifyPaymentId,
        amount: Number(o.amount),
        currency: o.currency,
        status: 'paid',
        raw_payload: { verify_fallback: true, activated_by: teacherId, reason: 'Verify-fallback after RPC succeeded but enrollment missing' },
        confirmed_by: teacherId,
      })
      .then(({ error }) => {
        if (error) console.warn('[teacher:activate] verify-fallback payments insert failed (non-critical)', error.message);
      });

    // Create financial_ledger (best effort)
    const { data: subjectRow } = await supabaseServer
      .from('subjects')
      .select('teacher_id')
      .eq('id', o.subject_id)
      .maybeSingle();
    const ledgerTeacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id ?? teacherId;
    // v112: per-teacher commission resolution (falls back to global rate).
    // Snapshot is preserved in financial_ledger.commission_rate.
    const commissionResolution = await getEffectiveCommissionRate(ledgerTeacherId);
    const commissionRate = commissionResolution.rate;
    // v112: v88 fees-on-top split (from order_fees snapshot when
    // present). For pre-v88 orders, falls back to legacy
    // calculateShares() inside the helper.
    const grossAmount = Number(o.grand_total ?? o.amount);
    const baseAmount = o.base_amount ?? null;
    let splitResult: Awaited<ReturnType<typeof calculateSharesFromOrderFees>> | undefined;
    try {
      splitResult = await calculateSharesFromOrderFees(orderId, grossAmount, baseAmount, commissionRate);
    } catch (err) {
      if (err instanceof OrderFeesSnapshotError) {
        // Fail safely — log + skip ledger insert.
        console.warn('[teacher:activate] verify-fallback: order_fees snapshot invalid', {
          orderId,
          reason: err.reason,
        });
      } else {
        throw err;
      }
    }

    const { data: paymentRow } = await supabaseServer
      .from('payments')
      .select('id')
      .eq('provider_payment_id', verifyPaymentId)
      .maybeSingle();
    const paymentId = (paymentRow as { id: string } | null)?.id;
    if (paymentId && splitResult) {
      const insertPayload: Record<string, unknown> = {
        payment_id: paymentId,
        order_id: orderId,
        student_id: o.student_id,
        subject_id: o.subject_id,
        teacher_id: ledgerTeacherId,
        gateway_id: null,
        provider_payment_id: verifyPaymentId,
        currency: o.currency,
        gross_amount: splitResult.grossAmount,
        platform_share: splitResult.platformShare,
        teacher_share: splitResult.teacherShare,
        gateway_fee: 0,
        net_amount: splitResult.netAmount,
        commission_rate: commissionRate,
        status: 'paid',
      };
      if (splitResult.kind === 'v88') {
        insertPayload.subscription_total = splitResult.subscriptionTotal;
        insertPayload.tax_amount = splitResult.taxAmount;
        insertPayload.other_fees_amount = splitResult.otherFeesAmount;
        insertPayload.fees_breakdown = splitResult.feesBreakdown;
      }
      await supabaseServer
        .from('financial_ledger')
        .insert(insertPayload)
        .then(({ error }) => {
          if (error) console.warn('[teacher:activate] verify-fallback financial_ledger insert failed (non-critical)', error.message);
          else console.info('[teacher:activate] financial_ledger created (verify-fallback)', { orderId, paymentId, splitSource: splitResult!.kind });
        });
    }

    return NextResponse.json({
      success: true,
      order_id: orderId,
      message: 'تم تفعيل الاشتراك (verify-fallback path)',
    });
  }

  return NextResponse.json({
    success: true,
    order_id: orderId,
    message: result.already_paid ? 'الطلب مُفعّل بالفعل' : 'تم تفعيل الاشتراك يدويًا',
  });
}
