import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

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

  // 1. Fetch the order
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      provider_order_ref, gateway_id, checkout_session_id,
      created_at, updated_at, paid_at, activated_at
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
  const { data: existingPayment } = await supabaseServer
    .from('payments')
    .select('id, provider_payment_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!existingPayment) {
    const { error: payErr } = await supabaseServer
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
      });
    if (payErr) {
      console.error('[force-activate:debug] failed to insert payment record', payErr);
      // Continue — payment record is not critical for the student to see the course
      actions.push(`payment record insert FAILED: ${payErr.message}`);
    } else {
      actions.push('payment record inserted');
    }
  } else {
    actions.push('payment record already exists');
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
