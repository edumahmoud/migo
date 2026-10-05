import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';
// v112: per-teacher commission resolver + v88 fees-on-top split helper
import { getEffectiveCommissionRate, calculateSharesFromOrderFees, OrderFeesSnapshotError } from '@/lib/payment/commission';

/**
 * POST /api/admin/orders/[id]/force-activate
 *
 * Force-activates an order BYPASSING the activate_subscription_after_payment
 * RPC. Directly:
 *   1. Marks the order as 'paid' + sets paid_at + activated_at
 *   2. UPSERTs the subject_students enrollment (status='approved')
 *   3. Activates the student's account_status (if 'pending')
 *   4. Inserts a payment record (with a manual_payment_id)
 *   5. Inserts a financial_ledger record (with the snapshot fields)
 *
 * Use this when the RPC fails for any reason (e.g., missing columns,
 * RPC code error, schema mismatch). After this endpoint succeeds:
 *   - The order is 'paid'
 *   - The student can see the course in their list
 *   - The student's account is active
 *
 * This endpoint is IDEMPOTENT — calling it multiple times on the
 * same order is safe (won't double-charge or create duplicate
 * enrollments).
 *
 * Admin-only.
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const adminId = authResult.user.id;
  const { id: orderId } = await ctx.params;

  // 1. Fetch the order (v112: include base_amount + grand_total for
  //    the v88 fees-on-top split computation in the ledger insert).
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      provider_order_ref, gateway_id, checkout_session_id,
      created_at, updated_at, paid_at, activated_at,
      base_amount, fees_total, grand_total
    `)
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return NextResponse.json(
      { success: false, error: 'الطلب غير موجود' },
      { status: 404 },
    );
  }

  const o = order as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    status: string;
    provider_order_ref: string | null;
    gateway_id: string | null;
    checkout_session_id: string | null;
    created_at: string;
    updated_at: string;
    paid_at: string | null;
    activated_at: string | null;
    // v112: v88 fees-on-top columns (NULL for pre-v88 orders)
    base_amount: number | null;
    fees_total: number | null;
    grand_total: number | null;
  };

  console.info('[force-activate:debug] order fetched', {
    orderId: o.id,
    status: o.status,
    student_id: o.student_id,
    subject_id: o.subject_id,
    amount: o.amount,
  });

  const now = new Date().toISOString();
  const manualPaymentId = `force_${randomUUID()}`;
  const actions: string[] = [];

  // 2. Mark order as paid (if not already)
  if (o.status !== 'paid') {
    const { error: updErr } = await supabaseServer
      .from('orders')
      .update({
        status: 'paid',
        paid_at: o.paid_at ?? now,
        activated_at: o.activated_at ?? now,
        updated_at: now,
      })
      .eq('id', orderId)
      .eq('status', 'pending'); // defense-in-depth
    if (updErr) {
      console.error('[force-activate:debug] failed to mark order as paid', updErr);
      return NextResponse.json(
        { success: false, error: `Failed to mark order as paid: ${updErr.message}` },
        { status: 500 },
      );
    }
    actions.push('order marked as paid');
  } else {
    actions.push('order already paid');
  }

  // 3. Insert payment record (if not exists for this order)
  let paymentId: string | null = null;
  const { data: existingPayment } = await supabaseServer
    .from('payments')
    .select('id, provider_payment_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!existingPayment) {
    const { data: newPayment, error: payErr } = await supabaseServer
      .from('payments')
      .insert({
        order_id: orderId,
        provider_payment_id: manualPaymentId,
        amount: Number(o.amount),
        currency: o.currency,
        status: 'paid',
        raw_payload: {
          force_activate: true,
          activated_by: adminId,
          activated_at: now,
          reason: 'Manual force-activation by admin (bypassing RPC)',
        },
        confirmed_by: adminId,
      })
      .select('id')
      .single();
    if (payErr) {
      console.error('[force-activate:debug] failed to insert payment record', payErr);
      // Continue — payment record is not critical for the student to see the course
      actions.push(`payment record insert FAILED: ${payErr.message}`);
    } else {
      paymentId = (newPayment as { id: string }).id;
      actions.push('payment record inserted');
    }
  } else {
    paymentId = (existingPayment as { id: string }).id;
    actions.push('payment record already exists');
  }

  // 3b. Insert financial_ledger record (P0 FIX — was missing in v78/v84 force-activate)
  // The original docstring claimed this step existed (line 16: "Inserts a
  // financial_ledger record") but the code never did. Every force-activate
  // produced a paid order with no revenue record. This block mirrors the
  // backfill-financial-ledger endpoint's logic.
  if (paymentId) {
    const { data: existingLedger } = await supabaseServer
      .from('financial_ledger')
      .select('id')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (!existingLedger) {
      // Snapshot teacher_id from subjects table
      const { data: subjectRow } = await supabaseServer
        .from('subjects')
        .select('teacher_id')
        .eq('id', o.subject_id)
        .maybeSingle();
      const teacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id
        ?? '00000000-0000-0000-0000-000000000000';

      // v112: resolve commission_rate for the legacy display snapshot
      // (per-teacher users.commission_rate → global commission_rates → 0).
      const commissionResolution = await getEffectiveCommissionRate(teacherId);
      const commissionRate = commissionResolution.rate;

      // v112: financial calculations come from the v88 order_fees
      // snapshot when present. For pre-v88 orders (no base_amount and
      // no order_fees), fall back to legacy calculateShares().
      const grossAmount = Number(o.grand_total ?? o.amount);
      const baseAmount = o.base_amount ?? null;
      let splitResult: Awaited<ReturnType<typeof calculateSharesFromOrderFees>> | undefined;
      try {
        splitResult = await calculateSharesFromOrderFees(orderId, grossAmount, baseAmount, commissionRate);
      } catch (err) {
        if (err instanceof OrderFeesSnapshotError) {
          // Fail safely — do NOT produce a silently incorrect ledger
          // row. The order is still marked paid (step 2 above), so the
          // student gets access to the course. The operator can run
          // /api/admin/backfill-financial-ledger after fixing the
          // snapshot.
          console.error('[force-activate:debug] order_fees snapshot invalid', {
            orderId,
            reason: err.reason,
          });
          actions.push(`financial_ledger insert SKIPPED: order_fees snapshot invalid — ${err.reason}`);
        } else {
          throw err;
        }
      }

      if (splitResult) {
        // Build the insert payload. For v88 orders, populate the v88
        // columns (subscription_total, tax_amount, other_fees_amount,
        // fees_breakdown). For legacy orders, omit them (DB defaults
        // apply: tax_amount=0, other_fees_amount=0, fees_breakdown=[]).
        const insertPayload: Record<string, unknown> = {
          payment_id: paymentId,
          order_id: orderId,
          student_id: o.student_id,
          subject_id: o.subject_id,
          teacher_id: teacherId,
          gateway_id: o.gateway_id,
          provider_payment_id: manualPaymentId,
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

        const { error: ledgerErr } = await supabaseServer
          .from('financial_ledger')
          .insert(insertPayload);

        if (ledgerErr) {
          console.error('[force-activate:debug] failed to insert financial_ledger', ledgerErr);
          actions.push(`financial_ledger insert FAILED: ${ledgerErr.message}`);
        } else {
          actions.push(`financial_ledger record inserted (split source: ${splitResult.kind})`);
        }
      }
    } else {
      actions.push('financial_ledger record already exists');
    }
  }

  // 4. UPSERT subject_students enrollment (status='approved')
  //    This is the CRITICAL step — makes the course appear in the student's list
  const { data: existingEnrollment } = await supabaseServer
    .from('subject_students')
    .select('id, status')
    .eq('subject_id', o.subject_id)
    .eq('student_id', o.student_id)
    .maybeSingle();

  if (existingEnrollment) {
    // Update existing enrollment
    const existing = existingEnrollment as { id: string; status: string };
    if (existing.status !== 'approved') {
      const { error: updErr } = await supabaseServer
        .from('subject_students')
        .update({
          status: 'approved',
          enrollment_method: 'self_paid',
          enrolled_at: now,
          monthly_price: Number(o.amount),
          current_period_start: now,
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', existing.id);
      if (updErr) {
        console.error('[force-activate:debug] failed to update enrollment', updErr);
        actions.push(`enrollment update FAILED: ${updErr.message}`);
      } else {
        actions.push('enrollment updated to approved');
      }
    } else {
      actions.push('enrollment already approved');
    }
  } else {
    // Insert new enrollment
    const { error: insErr } = await supabaseServer
      .from('subject_students')
      .insert({
        subject_id: o.subject_id,
        student_id: o.student_id,
        status: 'approved',
        enrollment_method: 'self_paid',
        enrolled_at: now,
        monthly_price: Number(o.amount),
        current_period_start: now,
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    if (insErr) {
      console.error('[force-activate:debug] failed to insert enrollment', insErr);
      actions.push(`enrollment insert FAILED: ${insErr.message}`);
    } else {
      actions.push('enrollment inserted (approved)');
    }
  }

  // 5. Activate student's account_status (if pending)
  const { data: student } = await supabaseServer
    .from('users')
    .select('id, account_status')
    .eq('id', o.student_id)
    .maybeSingle();

  if (student) {
    const s = student as { id: string; account_status: string | null };
    if (s.account_status !== 'active') {
      const { error: userErr } = await supabaseServer
        .from('users')
        .update({
          account_status: 'active',
          updated_at: now,
        })
        .eq('id', o.student_id)
        .in('account_status', ['pending', 'pending_verification', null]); // Don't un-suspend
      if (userErr) {
        console.error('[force-activate:debug] failed to activate student account', userErr);
        actions.push(`student account activation FAILED: ${userErr.message}`);
      } else {
        actions.push('student account activated');
      }
    } else {
      actions.push('student account already active');
    }
  }

  logPaymentEvent({
    level: 'info',
    operation: 'createPayment',
    orderId: orderId,
    success: true,
    errorCode: 'FORCE_ACTIVATED_BY_ADMIN',
    message: `Order force-activated by admin ${adminId}. Actions: ${actions.join('; ')}`,
  });

  console.info('[force-activate:debug] completed', { orderId, actions });

  return NextResponse.json({
    success: true,
    order_id: orderId,
    student_id: o.student_id,
    subject_id: o.subject_id,
    actions,
    message: 'تم تفعيل الطلب بالكامل — الطالب هيتقدر يشوف المقرر في قائمته بعد ما يعمل refresh',
  });
}
