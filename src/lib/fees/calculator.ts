/**
 * Fee Calculator — v88 fees-on-top model
 *
 * Given the base subscription total (sum of subject prices) and the
 * active fee_catalog rows, compute:
 *   - per-fee calculated_amount (the EGP amount added)
 *   - fees_total (sum of all fee amounts)
 *   - grand_total (base + fees_total) — sent to Paymob
 *
 * Rules:
 *   - percentage fees are computed as: (base * value / 100)
 *   - flat fees are computed as: value (a fixed EGP amount)
 *   - all fees are computed against the base subscription total
 *     (NOT compounded on top of each other)
 *
 * This is a PURE function — no DB access. The caller fetches the
 * active fee_catalog rows and passes them in.
 */

export interface FeeCatalogRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  fee_kind: 'percentage' | 'flat';
  value: number;           // percentage 0-100 OR flat EGP amount
  sort_order: number;
}

export interface AppliedFee extends FeeCatalogRow {
  base_amount: number;        // the basis used (always = baseTotal passed in)
  calculated_amount: number;  // EGP amount added
}

export interface FeeBreakdown {
  fees: AppliedFee[];
  base_total: number;          // sum of subject prices
  fees_total: number;          // sum of calculated_amounts
  grand_total: number;         // base_total + fees_total
}

/**
 * Compute the fee breakdown for a given subscription base total.
 *
 * @param baseTotal  Sum of subject prices (e.g., 100 EGP for one subject
 *                   or 250 EGP for two subjects at 100+150)
 * @param fees      Active fee_catalog rows (already filtered to is_active=true)
 * @returns          The breakdown: per-fee amounts + totals
 */
export function calculateFees(baseTotal: number, fees: FeeCatalogRow[]): FeeBreakdown {
  if (!Number.isFinite(baseTotal) || baseTotal < 0) {
    return { fees: [], base_total: 0, fees_total: 0, grand_total: 0 };
  }

  // Sort by sort_order (stable) so the breakdown is deterministic
  const sortedFees = [...fees].sort((a, b) => a.sort_order - b.sort_order);

  const applied: AppliedFee[] = [];
  let feesTotal = 0;

  for (const fee of sortedFees) {
    let amount: number;
    if (fee.fee_kind === 'percentage') {
      // Round to 2 decimals (piastre precision) to avoid floating-point drift
      amount = Math.round((baseTotal * fee.value / 100) * 100) / 100;
    } else {
      // flat fee — value is the EGP amount
      amount = Math.round(fee.value * 100) / 100;
    }

    if (amount < 0) amount = 0; // safety

    applied.push({
      ...fee,
      base_amount: baseTotal,
      calculated_amount: amount,
    });
    feesTotal += amount;
  }

  // Round feesTotal + grand_total to 2 decimals
  feesTotal = Math.round(feesTotal * 100) / 100;
  const grandTotal = Math.round((baseTotal + feesTotal) * 100) / 100;

  return {
    fees: applied,
    base_total: Math.round(baseTotal * 100) / 100,
    fees_total: feesTotal,
    grand_total: grandTotal,
  };
}

/**
 * Convenience: convert a FeeBreakdown to the JSONB shape stored in
 * financial_ledger.fees_breakdown (lighter than the full AppliedFee
 * — we drop the `id` and `sort_order` which are admin-side only).
 */
export function breakdownToJsonb(breakdown: FeeBreakdown): Array<{
  code: string;
  name_ar: string;
  name_en: string;
  fee_kind: string;
  value: number;
  base_amount: number;
  calculated_amount: number;
}> {
  return breakdown.fees.map((f) => ({
    code: f.code,
    name_ar: f.name_ar,
    name_en: f.name_en,
    fee_kind: f.fee_kind,
    value: f.value,
    base_amount: f.base_amount,
    calculated_amount: f.calculated_amount,
  }));
}
