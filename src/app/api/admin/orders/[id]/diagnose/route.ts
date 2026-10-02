import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/orders/[id]/diagnose
 *
 * Diagnostic endpoint that returns the FULL state of an order:
 *   - Order details (status, paid_at, activated_at, provider_order_ref, etc.)
 *   - The student's account_status
 *   - The subject_students enrollment (if it exists)
 *   - The payment record (if it exists)
 *   - The financial_ledger record (if it exists)
 *
 * Used by the admin to diagnose why an order's activation is failing.
 *
 * Admin-only.
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id: orderId } = await ctx.params;

  // 1. Get the order
  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      provider_order_ref, gateway_id, checkout_session_id,
      created_at, updated_at, paid_at, activated_at
    `)
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr) {
    return NextResponse.json(
      { success: false, error: `Failed to fetch order: ${orderErr.message}` },
      { status: 500 },
    );
  }

  if (!order) {
    return NextResponse.json(
      { success: false, error: 'Order not found' },
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

  // 2. Get the student's account status
  const { data: student, error: studentErr } = await supabaseServer
    .from('users')
    .select('id, email, name, account_status, phone, phone_verified')
    .eq('id', o.student_id)
    .maybeSingle();

  // 3. Get the subject_students enrollment (if any)
  const { data: enrollment, error: enrollmentErr } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, student_id, status, enrollment_method, enrolled_at, current_period_start, current_period_end, next_billing_at, monthly_price')
    .eq('subject_id', o.subject_id)
    .eq('student_id', o.student_id)
    .maybeSingle();

  // 4. Get the payment record (if any)
  const { data: payment, error: paymentErr } = await supabaseServer
    .from('payments')
    .select('id, order_id, provider_payment_id, amount, currency, status, raw_payload, confirmed_by, created_at')
    .eq('order_id', orderId)
    .maybeSingle();

  // 5. Get the financial_ledger record (if any)
  const { data: ledger, error: ledgerErr } = await supabaseServer
    .from('financial_ledger')
    .select('id, payment_id, order_id, student_id, subject_id, teacher_id, provider_payment_id, currency, gross_amount, platform_share, teacher_share, gateway_fee, net_amount, commission_rate, status, created_at')
    .eq('order_id', orderId)
    .maybeSingle();

  // 6. Get the subject details
  const { data: subject, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id, price, level, sub_level')
    .eq('id', o.subject_id)
    .maybeSingle();

  // ── Build the diagnosis ──
  const diagnosis = {
    order: {
      id: o.id,
      status: o.status,
      amount: Number(o.amount),
      currency: o.currency,
      student_id: o.student_id,
      subject_id: o.subject_id,
      provider_order_ref: o.provider_order_ref,
      gateway_id: o.gateway_id,
      checkout_session_id: o.checkout_session_id,
      created_at: o.created_at,
      updated_at: o.updated_at,
      paid_at: o.paid_at,
      activated_at: o.activated_at,
    },
    student: student
      ? {
          id: (student as { id: string }).id,
          email: (student as { email: string }).email,
          name: (student as { name: string | null }).name,
          account_status: (student as { account_status: string | null }).account_status,
          phone: (student as { phone: string | null }).phone,
          phone_verified: (student as { phone_verified?: boolean }).phone_verified,
        }
      : null,
    studentError: studentErr?.message ?? null,
    subject: subject
      ? {
          id: (subject as { id: string }).id,
          name: (subject as { name: string }).name,
          teacher_id: (subject as { teacher_id: string }).teacher_id,
          price: (subject as { price: number }).price,
        }
      : null,
    subjectError: subjectErr?.message ?? null,
    enrollment: enrollment
      ? {
          id: (enrollment as { id: string }).id,
          status: (enrollment as { status: string }).status,
          enrollment_method: (enrollment as { enrollment_method: string }).enrollment_method,
          enrolled_at: (enrollment as { enrolled_at: string }).enrolled_at,
          current_period_start: (enrollment as { current_period_start: string | null }).current_period_start,
          current_period_end: (enrollment as { current_period_end: string | null }).current_period_end,
          monthly_price: (enrollment as { monthly_price: number | null }).monthly_price,
        }
      : null,
    enrollmentError: enrollmentErr?.message ?? null,
    payment: payment
      ? {
          id: (payment as { id: string }).id,
          provider_payment_id: (payment as { provider_payment_id: string }).provider_payment_id,
          amount: Number((payment as { amount: number }).amount),
          currency: (payment as { currency: string }).currency,
          status: (payment as { status: string }).status,
          confirmed_by: (payment as { confirmed_by: string | null }).confirmed_by,
          created_at: (payment as { created_at: string }).created_at,
        }
      : null,
    paymentError: paymentErr?.message ?? null,
    ledger: ledger
      ? {
          id: (ledger as { id: string }).id,
          gross_amount: Number((ledger as { gross_amount: number }).gross_amount),
          platform_share: Number((ledger as { platform_share: number }).platform_share),
          teacher_share: Number((ledger as { teacher_share: number }).teacher_share),
          net_amount: Number((ledger as { net_amount: number }).net_amount),
          commission_rate: Number((ledger as { commission_rate: number }).commission_rate),
          status: (ledger as { status: string }).status,
          created_at: (ledger as { created_at: string }).created_at,
        }
      : null,
    ledgerError: ledgerErr?.message ?? null,

    // ── Diagnosis verdict ──
    verdict: {
      order_paid: o.status === 'paid',
      enrollment_exists: !!enrollment,
      enrollment_approved: enrollment && (enrollment as { status: string }).status === 'approved',
      payment_recorded: !!payment,
      ledger_recorded: !!ledger,
      student_active: student && (student as { account_status: string | null }).account_status === 'active',
    },
    issues: [] as string[],
    recommendedActions: [] as string[],
  };

  // ── Build issues + recommended actions ──
  if (o.status !== 'paid') {
    diagnosis.issues.push(`Order status is '${o.status}' (expected 'paid')`);
    diagnosis.recommendedActions.push('Call POST /api/admin/orders/[id]/force-activate to manually mark as paid + activate enrollment');
  }
  if (!enrollment) {
    diagnosis.issues.push('No subject_students enrollment record exists');
    diagnosis.recommendedActions.push('Call POST /api/admin/orders/[id]/force-activate to create the enrollment');
  } else if ((enrollment as { status: string }).status !== 'approved') {
    diagnosis.issues.push(`Enrollment status is '${(enrollment as { status: string }).status}' (expected 'approved')`);
    diagnosis.recommendedActions.push('Call POST /api/admin/orders/[id]/force-activate to update enrollment to approved');
  }
  if (student && (student as { account_status: string | null }).account_status !== 'active') {
    diagnosis.issues.push(`Student account_status is '${(student as { account_status: string | null }).account_status}' (expected 'active')`);
    diagnosis.recommendedActions.push('Call POST /api/admin/orders/[id]/force-activate to activate student account');
  }

  return NextResponse.json({
    success: true,
    diagnosis,
  });
}
