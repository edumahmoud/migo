import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { randomUUID } from 'crypto';
// v112: per-teacher commission resolver + v88 fees-on-top split helper
import { getEffectiveCommissionRate, calculateSharesFromOrderFees, OrderFeesSnapshotError } from '@/lib/payment/commission';

/**
 * GET /api/admin/backfill-financial-ledger
 *
 * Same as POST — but accessible via browser URL bar.
 * Admin can just visit this URL to run the backfill.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/admin/backfill-financial-ledger
 *
 * Backfills missing `payments` + `financial_ledger` rows for orders
 * that were marked as 'paid' but don't have corresponding financial
 * records.
 *
 * This happens when:
 *   - The activate_subscription_after_payment RPC failed
 *   - The fallback path only created subject_students (not financial_ledger)
 *   - The verify-after-redirect fallback ran before the fix that adds
 *     financial_ledger inserts
 *
 * This endpoint:
 *   1. Finds all orders with status='paid'
 *   2. For each, checks if a financial_ledger row exists (by order_id)
 *   3. If NOT, creates:
 *      a. A `payments` row (with a backfill_<order_id> provider_payment_id)
 *      b. A `financial_ledger` row (with snapshot fields: teacher_id,
 *         commission_rate, gross_amount, platform_share, teacher_share)
 *
 * Idempotent — safe to run multiple times (skips orders that already
 * have financial_ledger rows).
 *
 * Admin-only.
 *
 * Returns a summary of what was backfilled.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  console.info('[backfill-financial-ledger] starting backfill...');

  // 1. Get ALL paid orders (no financial_ledger filter — we'll check below)
  //    v112: include base_amount + grand_total for v88 split computation.
  const { data: paidOrders, error: ordersErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, status, gateway_id, paid_at, created_at, base_amount, grand_total')
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(500); // safety limit — adjust if needed

  if (ordersErr) {
    return NextResponse.json(
      { success: false, error: `Failed to fetch paid orders: ${ordersErr.message}` },
      { status: 500 },
    );
  }

  console.info('[backfill-financial-ledger] found paid orders', {
    count: paidOrders?.length ?? 0,
  });

  if (!paidOrders || paidOrders.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No paid orders found — nothing to backfill',
      summary: { total_paid_orders: 0, backfilled: 0, skipped: 0 },
    });
  }

  // 2. Get existing financial_ledger order_ids (to skip them)
  const orderIds = paidOrders.map((o: { id: string }) => o.id);
  const { data: existingLedger } = await supabaseServer
    .from('financial_ledger')
    .select('order_id')
    .in('order_id', orderIds);

  const existingOrderIds = new Set(
    (existingLedger ?? []).map((l: { order_id: string }) => l.order_id)
  );

  console.info('[backfill-financial-ledger] orders with existing ledger', {
    count: existingOrderIds.size,
  });

  // 3. Get existing payments order_ids (to skip them)
  const { data: existingPayments } = await supabaseServer
    .from('payments')
    .select('order_id')
    .in('order_id', orderIds);

  const existingPaymentOrderIds = new Set(
    (existingPayments ?? []).map((p: { order_id: string }) => p.order_id)
  );

  // 4. v111: per-teacher commission resolution.
  //    The OLD backfill used a single global rate snapshot for ALL paid
  //    orders being backfilled. That was acceptable when only the global
  //    rate existed. With per-teacher overrides, the correct rate for
  //    each backfilled order is whatever was effective for THAT teacher
  //    at backfill time (since we cannot retroactively determine the
  //    rate that should have been used at payment time for orders that
  //    predate the v78 ledger). The per-teacher lookup resolves the
  //    rate per order based on subjectRow.teacher_id.
  //
  //    The resolved rate is snapshotted into financial_ledger.commission_rate
  //    for that order — future changes do NOT retroactively affect it.
  //
  //    We no longer fetch a single commission rate here. Instead we
  //    resolve it per-order inside the loop below.

  // 5. Get all subject teacher_ids (snapshot)
  const subjectIds = [...new Set(paidOrders.map((o: { subject_id: string }) => o.subject_id))];
  const { data: subjectsData } = await supabaseServer
    .from('subjects')
    .select('id, teacher_id')
    .in('id', subjectIds);

  const subjectTeacherMap = new Map<string, string>();
  for (const s of (subjectsData ?? []) as Array<{ id: string; teacher_id: string }>) {
    subjectTeacherMap.set(s.id, s.teacher_id);
  }

  // 6. Backfill: for each paid order WITHOUT a financial_ledger row
  let backfilled = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  for (const order of paidOrders) {
    const o = order as {
      id: string;
      student_id: string;
      subject_id: string;
      amount: number;
      currency: string;
      gateway_id: string | null;
      paid_at: string | null;
      created_at: string;
      // v112: v88 fees-on-top columns (NULL for pre-v88 orders)
      base_amount: number | null;
      grand_total: number | null;
    };

    // Skip if financial_ledger already exists for this order
    if (existingOrderIds.has(o.id)) {
      skipped++;
      continue;
    }

    const teacherId = subjectTeacherMap.get(o.subject_id) ?? '00000000-0000-0000-0000-000000000000';
    // v112: resolve commission_rate for the legacy display snapshot
    // (per-teacher users.commission_rate → global commission_rates → 0).
    const commissionResolution = await getEffectiveCommissionRate(teacherId);
    const commissionRate = commissionResolution.rate;

    // v112: financial split comes from the v88 order_fees snapshot
    // when present. For pre-v88 orders, fall back to legacy
    // calculateShares() (computed inside the helper).
    const grossAmount = Number(o.grand_total ?? o.amount);
    const baseAmount = o.base_amount ?? null;

    let splitResult: Awaited<ReturnType<typeof calculateSharesFromOrderFees>> | undefined;
    try {
      splitResult = await calculateSharesFromOrderFees(o.id, grossAmount, baseAmount, commissionRate);
    } catch (err) {
      if (err instanceof OrderFeesSnapshotError) {
        // Fail safely — log + skip this order.
        console.error('[backfill] order_fees snapshot invalid', {
          orderId: o.id,
          reason: err.reason,
        });
        errors++;
        errorDetails.push(`Order ${o.id}: order_fees snapshot invalid — ${err.reason}`);
        continue;
      } else {
        throw err;
      }
    }

    if (!splitResult) {
      // Shouldn't happen, but defensive.
      errors++;
      errorDetails.push(`Order ${o.id}: split result undefined`);
      continue;
    }

    const now = new Date().toISOString();
    const backfillPaymentId = `backfill_${o.id}`;

    try {
      // a. Insert payment (if not exists)
      let paymentId: string | null = null;

      if (!existingPaymentOrderIds.has(o.id)) {
        const { data: newPayment, error: payErr } = await supabaseServer
          .from('payments')
          .insert({
            order_id: o.id,
            provider_payment_id: backfillPaymentId,
            amount: grossAmount,
            currency: o.currency,
            status: 'paid',
            raw_payload: {
              backfill: true,
              reason: 'Backfill from admin — missing financial record for previously-paid order',
              original_paid_at: o.paid_at,
              order_created_at: o.created_at,
            },
            confirmed_by: null,
          })
          .select('id')
          .single();

        if (payErr) {
          // Maybe it already exists — try to fetch it
          const { data: existingPay } = await supabaseServer
            .from('payments')
            .select('id')
            .eq('order_id', o.id)
            .maybeSingle();
          paymentId = (existingPay as { id: string } | null)?.id ?? null;
        } else {
          paymentId = (newPayment as { id: string }).id;
        }
      } else {
        // Payment exists — fetch its id
        const { data: existingPay } = await supabaseServer
          .from('payments')
          .select('id')
          .eq('order_id', o.id)
          .maybeSingle();
        paymentId = (existingPay as { id: string } | null)?.id ?? null;
      }

      if (!paymentId) {
        console.error('[backfill] could not get/create payment for order', { orderId: o.id });
        errors++;
        errorDetails.push(`Order ${o.id}: could not get/create payment record`);
        continue;
      }

      // b. Insert financial_ledger with v88 columns when available
      const insertPayload: Record<string, unknown> = {
        payment_id: paymentId,
        order_id: o.id,
        student_id: o.student_id,
        subject_id: o.subject_id,
        teacher_id: teacherId,
        gateway_id: o.gateway_id,
        provider_payment_id: backfillPaymentId,
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
        console.error('[backfill] financial_ledger insert failed', {
          orderId: o.id,
          error: ledgerErr.message,
        });
        errors++;
        errorDetails.push(`Order ${o.id}: ${ledgerErr.message}`);
      } else {
        backfilled++;
        console.info('[backfill] created financial_ledger', {
          orderId: o.id,
          teacherId,
          teacherShare: splitResult.teacherShare,
          splitSource: splitResult.kind,
          paymentId,
        });
      }
    } catch (err) {
      console.error('[backfill] unexpected error', { orderId: o.id, error: err });
      errors++;
      errorDetails.push(`Order ${o.id}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  const summary = {
    total_paid_orders: paidOrders.length,
    backfilled,
    skipped, // already had financial_ledger
    errors,
    // v112: commission is now resolved per-teacher and split source
    // is the v88 order_fees snapshot when available. The detailed
    // per-order rate is snapshotted into each
    // financial_ledger.commission_rate column; the summary notes the
    // resolution strategy.
    commission_resolution: 'v112: per-teacher (users.commission_rate) → global commission_rates → 0; split source = v88 order_fees snapshot when present, else legacy calculateShares()',
    error_details: errorDetails.slice(0, 10), // first 10 errors
  };

  console.info('[backfill-financial-ledger] complete', summary);

  return NextResponse.json({
    success: true,
    message: `Backfill complete: ${backfilled} financial_ledger rows created, ${skipped} already existed, ${errors} errors`,
    summary,
  });
}
