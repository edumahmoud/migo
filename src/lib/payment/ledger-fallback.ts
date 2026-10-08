/**
 * Ledger Fallback Helper — v117
 *
 * When the activate_subscription_after_payment RPC fails (or succeeds
 * but leaves the enrollment missing), the teacher/agent/admin activation
 * routes need a fallback path that:
 *   1. Marks the order as paid
 *   2. UPSERTs subject_students enrollment
 *   3. Activates the student's account
 *   4. Inserts a payment record
 *   5. Inserts a financial_ledger record (with the v88 fees-on-top split)
 *
 * Steps 1-4 were already implemented inline in each route. Step 5 was
 * only implemented in the teacher + admin routes — the AGENT route was
 * missing it entirely. This helper centralizes step 5 so all three
 * routes use the same logic, and so future changes only need to touch
 * one file.
 *
 * The helper:
 *   - Looks up the subject's teacher_id
 *   - Resolves the per-teacher commission_rate (v112)
 *   - Computes the v88 fees-on-top split from the order_fees snapshot
 *   - Inserts the financial_ledger row (idempotent on payment_id)
 *
 * HISTORICAL SAFETY: this only creates NEW ledger rows. It never
 * modifies existing ones.
 */

import { supabaseServer } from '@/lib/supabase-server';
import {
  getEffectiveCommissionRate,
  calculateSharesFromOrderFees,
  OrderFeesSnapshotError,
  type SharesResult,
} from '@/lib/payment/commission';

export interface LedgerFallbackInput {
  orderId: string;
  paymentId: string;        // UUID from payments table
  providerPaymentId: string; // provider_payment_id string (e.g., "manual_agent_XXX")
  studentId: string;
  subjectId: string;
  currency: string;
  /** gross amount paid (= grand_total for v88 orders, = amount for legacy). */
  grossAmount: number;
  /** base_amount from the order row (NULL for pre-v88 orders). */
  baseAmount: number | null;
  /** activated_by user ID (teacher / agent / admin). */
  activatedBy: string;
  /** role of the activator (for logging). */
  activatedByRole: 'teacher' | 'registration_agent' | 'admin';
}

export interface LedgerFallbackResult {
  success: boolean;
  ledgerId?: string;
  error?: string;
  splitSource?: 'v88' | 'legacy';
}

/**
 * Create a financial_ledger row using the v88 fees-on-top split.
 *
 * - If order_fees rows exist for the order → v88 split (commission +
 *   tax + other fees come from the snapshot).
 * - If no order_fees rows AND base_amount IS NULL → legacy split
 *   using the per-teacher commission_rate.
 * - If no order_fees rows AND base_amount IS NOT NULL → OrderFeesSnapshotError
 *   is caught and we skip the ledger insert (fail safe — do NOT
 *   produce a silently incorrect row).
 *
 * Idempotent: if a ledger row already exists for this payment_id,
 * returns success without inserting.
 */
export async function createFinancialLedgerFallback(
  input: LedgerFallbackInput,
): Promise<LedgerFallbackResult> {
  const {
    orderId, paymentId, providerPaymentId,
    studentId, subjectId, currency,
    grossAmount, baseAmount,
    activatedBy, activatedByRole,
  } = input;

  // 1. Check if a ledger row already exists for this payment (idempotent).
  const { data: existing } = await supabaseServer
    .from('financial_ledger')
    .select('id')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (existing) {
    return {
      success: true,
      ledgerId: (existing as { id: string }).id,
      splitSource: 'v88',
    };
  }

  // 2. Resolve teacher_id from the subject (snapshot at activation time).
  const { data: subjectRow } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();
  const teacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id
    ?? '00000000-0000-0000-0000-000000000000';

  // 3. Resolve per-teacher commission_rate (v112).
  const commissionResolution = await getEffectiveCommissionRate(teacherId);
  const commissionRate = commissionResolution.rate;

  // 4. Compute the v88 fees-on-top split.
  let splitResult: SharesResult | undefined;
  try {
    splitResult = await calculateSharesFromOrderFees(
      orderId, grossAmount, baseAmount, commissionRate,
    );
  } catch (err) {
    if (err instanceof OrderFeesSnapshotError) {
      // Fail safe — do NOT produce an incorrect ledger row.
      console.error('[ledger-fallback] order_fees snapshot invalid', {
        orderId, reason: err.reason,
      });
      return {
        success: false,
        error: `order_fees snapshot invalid: ${err.reason}`,
      };
    }
    throw err;
  }

  if (!splitResult) {
    return { success: false, error: 'split computation returned undefined' };
  }

  // 5. Insert the financial_ledger row.
  const insertPayload: Record<string, unknown> = {
    payment_id: paymentId,
    order_id: orderId,
    student_id: studentId,
    subject_id: subjectId,
    teacher_id: teacherId,
    gateway_id: null,
    provider_payment_id: providerPaymentId,
    currency,
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

  const { data: inserted, error: insertErr } = await supabaseServer
    .from('financial_ledger')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr) {
    console.error('[ledger-fallback] insert failed', {
      orderId, paymentId, error: insertErr.message,
      activatedBy, activatedByRole,
    });
    return {
      success: false,
      error: insertErr.message,
    };
  }

  console.info('[ledger-fallback] financial_ledger created', {
    orderId, paymentId,
    ledgerId: (inserted as { id: string }).id,
    splitSource: splitResult.kind,
    commissionSource: commissionResolution.source,
    activatedBy, activatedByRole,
  });

  return {
    success: true,
    ledgerId: (inserted as { id: string }).id,
    splitSource: splitResult.kind,
  };
}
