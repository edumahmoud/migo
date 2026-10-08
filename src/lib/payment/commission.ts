/**
 * Per-Teacher Commission Resolver — v112
 *
 * Looks up the effective platform commission rate for a given
 * teacher. Resolution order:
 *
 *   1. users.commission_rate (per-teacher override)
 *      — set explicitly by admin via PATCH /api/admin/teachers/[id]/commission
 *   2. public.commission_rates where is_active = true (global fallback)
 *      — preserves existing behavior for teachers without an explicit override
 *   3. 0 (no commission configured)
 *
 * HISTORICAL SAFETY:
 *   - This function is called ONLY when a NEW financial_ledger row is
 *     being created (payment activation paths). The returned rate is
 *     snapshotted into financial_ledger.commission_rate, which is
 *     immutable after creation.
 *   - Changing users.commission_rate today does NOT recalculate
 *     or modify any existing financial_ledger row. The snapshot is
 *     preserved forever.
 *
 * This helper is used by:
 *   - activate_subscription_after_payment RPC (SQL — replicated logic)
 *   - /api/admin/orders/[id]/force-activate (TS — direct ledger insert)
 *   - /api/admin/backfill-financial-ledger (TS — backfill missing rows)
 *   - /api/student/orders/verify-after-redirect (TS — 3 fallback paths)
 *   - /api/teacher/subscriptions/activate (TS — verify-fallback path)
 *
 * The RPC has the same logic embedded in PL/pgSQL. Keep both in sync
 * if you change the resolution order.
 *
 * v112: the per-teacher column is `users.commission_rate`. The name
 * `commission_percentage` is FORBIDDEN — no code, test, or migration
 * should reference it.
 */

import { supabaseServer } from '@/lib/supabase-server';

export interface CommissionResolution {
  /** Effective commission percentage (0-100). */
  rate: number;
  /** Where the rate came from. */
  source: 'per_teacher' | 'global' | 'default_zero';
  /**
   * True if the per-teacher override was used (rate from
   * users.commission_rate). False if the global rate or 0 fallback
   * was used. Useful for audit logging.
   */
  perTeacherOverrideApplied: boolean;
}

/**
 * Returns the effective platform commission rate for a teacher.
 *
 * @param teacherId  UUID of the teacher (users.id where role='teacher').
 *                   If null/undefined, skips the per-teacher lookup and
 *                   goes straight to the global rate.
 */
export async function getEffectiveCommissionRate(
  teacherId: string | null | undefined,
): Promise<CommissionResolution> {
  // 1) Per-teacher override (users.commission_rate)
  if (teacherId) {
    const { data: teacherRow, error } = await supabaseServer
      .from('users')
      .select('commission_rate')
      .eq('id', teacherId)
      .maybeSingle();

    if (error) {
      // Log but continue — fall back to global rate.
      console.warn('[commission] per-teacher lookup failed', {
        teacherId,
        error: error.message,
      });
    } else {
      const perTeacherRate = (teacherRow as { commission_rate: number | null } | null)
        ?.commission_rate;
      if (perTeacherRate !== null && perTeacherRate !== undefined) {
        return {
          rate: perTeacherRate,
          source: 'per_teacher',
          perTeacherOverrideApplied: true,
        };
      }
    }
  }

  // 2) Global fallback (commission_rates)
  const { data: commissionRow, error: commissionErr } = await supabaseServer
    .from('commission_rates')
    .select('rate_percentage')
    .eq('is_active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (commissionErr) {
    console.warn('[commission] global rate lookup failed', {
      error: commissionErr.message,
    });
  }

  const globalRate = (commissionRow as { rate_percentage: number } | null)?.rate_percentage;
  if (globalRate !== null && globalRate !== undefined) {
    return {
      rate: globalRate,
      source: 'global',
      perTeacherOverrideApplied: false,
    };
  }

  // 3) Default 0%
  return {
    rate: 0,
    source: 'default_zero',
    perTeacherOverrideApplied: false,
  };
}

// ──────────────────────────────────────────────────────────────
// v88 fees-on-top model: split source is the order_fees snapshot
// ──────────────────────────────────────────────────────────────

/**
 * Discriminated union returned by calculateSharesFromOrderFees().
 *
 * - `kind: 'v88'` — the order has an order_fees snapshot. The split
 *    comes from that snapshot (commission + tax + other fees).
 * - `kind: 'legacy'` — the order is a pre-v88 order with no
 *    order_fees snapshot. The split is computed from the
 *    commission rate via the legacy calculateShares() helper.
 */
export type SharesResult =
  | {
      kind: 'v88';
      platformShare: number;
      teacherShare: number;
      netAmount: number;
      grossAmount: number;
      subscriptionTotal: number;
      taxAmount: number;
      otherFeesAmount: number;
      feesBreakdown: Array<{
        code: string;
        name_ar: string;
        name_en: string;
        fee_kind: string;
        value: number;
        base_amount: number;
        calculated_amount: number;
      }>;
    }
  | {
      kind: 'legacy';
      platformShare: number;
      teacherShare: number;
      netAmount: number;
      grossAmount: number;
    };

/**
 * Thrown when a v88 order's order_fees snapshot is missing or
 * invalid. The caller must NOT silently produce a financial_ledger
 * row in this state — let the existing error-handling path handle
 * it (skip + log).
 */
export class OrderFeesSnapshotError extends Error {
  readonly orderId: string;
  readonly reason: string;
  constructor(orderId: string, reason: string) {
    super(`Order ${orderId} fee snapshot is invalid: ${reason}`);
    this.name = 'OrderFeesSnapshotError';
    this.orderId = orderId;
    this.reason = reason;
  }
}

/**
 * Calculate the financial split for an order using the v88 fees-on-top
 * model. The order_fees snapshot (taken at checkout) is the
 * authoritative source for the split.
 *
 * Resolution:
 *
 * 1. Query order_fees for the order.
 * 2. If at least one row is returned → v88 model:
 *    - gross_amount       = grandTotal (or amount as fallback)
 *    - subscription_total = baseAmount (or amount as fallback)
 *    - platform_share     = SUM(platform_commission) + SUM(tax*) + SUM(other)
 *    - teacher_share      = subscription_total - SUM(platform_commission)
 *    - net_amount         = teacher_share
 * 3. If zero rows returned:
 *    - If baseAmount is NOT NULL (this is a v88 order missing its
 *      snapshot) → THROW OrderFeesSnapshotError. Do NOT silently
 *      produce an incorrect ledger row.
 *    - If baseAmount IS NULL (genuine pre-v88 order) → legacy path:
 *      use calculateShares(grossAmount, commissionRate).
 *
 * @param orderId       UUID of the order.
 * @param grossAmount  = order.grand_total ?? order.amount — what the
 *                      student paid (= grand_total for v88 orders).
 * @param baseAmount   = order.base_amount — sum of subject prices
 *                      (NULL for pre-v88 orders).
 * @param commissionRate  Resolved rate for the legacy fallback path
 *                        (when the order is genuinely pre-v88).
 */
export async function calculateSharesFromOrderFees(
  orderId: string,
  grossAmount: number,
  baseAmount: number | null,
  commissionRate: number,
): Promise<SharesResult> {
  // Fetch the order_fees snapshot
  const { data: feeRows, error } = await supabaseServer
    .from('order_fees')
    .select('code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount, sort_order')
    .eq('order_id', orderId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new OrderFeesSnapshotError(orderId, `order_fees query failed: ${error.message}`);
  }

  const rows = (feeRows ?? []) as Array<{
    code: string;
    name_ar: string;
    name_en: string;
    fee_kind: string;
    value: number;
    base_amount: number;
    calculated_amount: number;
    sort_order: number;
  }>;

  // ── Case 1: v88 order with order_fees snapshot ──
  if (rows.length > 0) {
    let platformCommissionAmt = 0;
    let taxAmount = 0;
    let otherFeesAmount = 0;
    const feesBreakdown = rows.map((r) => ({
      code: r.code,
      name_ar: r.name_ar,
      name_en: r.name_en,
      fee_kind: r.fee_kind,
      value: Number(r.value),
      base_amount: Number(r.base_amount),
      calculated_amount: Number(r.calculated_amount),
    }));

    for (const r of rows) {
      const amount = Number(r.calculated_amount);
      if (r.code === 'platform_commission') {
        platformCommissionAmt += amount;
      } else if (r.code.startsWith('tax')) {
        taxAmount += amount;
      } else {
        otherFeesAmount += amount;
      }
    }

    // Round to 2 decimals (piastre precision)
    platformCommissionAmt = Math.round(platformCommissionAmt * 100) / 100;
    taxAmount = Math.round(taxAmount * 100) / 100;
    otherFeesAmount = Math.round(otherFeesAmount * 100) / 100;

    // subscription_total: prefer base_amount; fall back to gross for
    // legacy orders that happen to have an order_fees snapshot but
    // no base_amount column populated (shouldn't happen in v88+,
    // but be defensive).
    const subscriptionTotal = baseAmount !== null && baseAmount !== undefined
      ? Number(baseAmount)
      : Number(grossAmount);

    // v88 split — mirrors the deployed RPC exactly
    const platformShare = Math.round(
      (platformCommissionAmt + taxAmount + otherFeesAmount) * 100,
    ) / 100;
    const teacherShare = Math.round(
      (subscriptionTotal - platformCommissionAmt) * 100,
    ) / 100;
    const netAmount = teacherShare;

    return {
      kind: 'v88',
      platformShare,
      teacherShare,
      netAmount,
      grossAmount: Number(grossAmount),
      subscriptionTotal,
      taxAmount,
      otherFeesAmount,
      feesBreakdown,
    };
  }

  // ── Case 2: no order_fees snapshot ──
  if (baseAmount !== null && baseAmount !== undefined) {
    // v88 order (has base_amount) but missing its order_fees snapshot.
    // This is a data integrity issue. Fail safely — do NOT produce a
    // silently incorrect ledger row.
    throw new OrderFeesSnapshotError(
      orderId,
      'order has base_amount (v88) but no order_fees snapshot rows',
    );
  }

  // Genuine pre-v88 order — use legacy split.
  const legacy = calculateShares(Number(grossAmount), commissionRate);
  return {
    kind: 'legacy',
    platformShare: legacy.platformShare,
    teacherShare: legacy.teacherShare,
    netAmount: legacy.teacherShare,
    grossAmount: Number(grossAmount),
  };
}

/**
 * LEGACY HELPER — pre-v88 simple split.
 *
 * Used ONLY for genuine pre-v88 orders that have no order_fees
 * snapshot AND no base_amount column. For all v88+ orders, use
 * calculateSharesFromOrderFees() instead.
 *
 * Invariants:
 *   - platform_share + teacher_share = gross (within rounding tolerance).
 *   - 0 <= commissionRate <= 100.
 */
export function calculateShares(
  grossAmount: number,
  commissionRate: number,
): { platformShare: number; teacherShare: number } {
  if (!Number.isFinite(grossAmount) || grossAmount < 0) {
    return { platformShare: 0, teacherShare: 0 };
  }
  if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
    throw new Error(`Invalid commission rate: ${commissionRate}`);
  }
  const platformShare = Math.round(grossAmount * commissionRate) / 100;
  const teacherShare = grossAmount - platformShare;
  return { platformShare, teacherShare };
}
