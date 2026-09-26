/**
 * Financial Ledger — Server-Side Calculation Helpers
 *
 * These functions are used by admin/diagnostic APIs to verify
 * or recalculate financial amounts. The authoritative calculation
 * happens inside the RPC (activate_subscription_after_payment)
 * which is the single source of truth.
 *
 * These helpers exist for:
 *   - Admin APIs that query the ledger
 *   - Diagnostic endpoints that verify ledger integrity
 *   - Future admin UI that shows financial summaries
 *
 * All calculations use integer arithmetic (cents/piasters) to
 * avoid floating-point errors. The DB stores NUMERIC(12,2) but
 * the JS layer works with cents to avoid precision loss.
 */

import type { GatewayProvider } from './types';

export interface FinancialCalculation {
  grossAmount: number;       // in major units (e.g., EGP)
  platformShare: number;     // platform's commission
  teacherShare: number;      // teacher's net
  gatewayFee: number;        // reserved (0 for now)
  netAmount: number;        // = teacherShare
  commissionRate: number;   // percentage (e.g., 10.00 = 10%)
  currency: string;
}

/**
 * Calculate financial amounts from gross + commission rate.
 * All values are in major units (EGP, not cents).
 * Uses ROUND to 2 decimal places to match NUMERIC(12,2) in DB.
 *
 * Rules:
 *   platform_share = ROUND(gross * rate / 100, 2)
 *   gateway_fee = 0 (reserved)
 *   teacher_share = gross - platform_share - gateway_fee
 *   net_amount = teacher_share
 *
 * Invariant: platform_share + teacher_share + gateway_fee <= gross
 *
 * @param grossAmount  The total amount paid
 * @param commissionRate  The platform's commission percentage (0-100)
 * @param currency  ISO 4217 currency code
 */
export function calculateFinancialShares(
  grossAmount: number,
  commissionRate: number,
  currency: string,
): FinancialCalculation {
  // Validate inputs
  if (grossAmount < 0) {
    throw new Error('Gross amount cannot be negative');
  }
  if (commissionRate < 0 || commissionRate > 100) {
    throw new Error(`Invalid commission rate: ${commissionRate}`);
  }

  // Calculate in cents to avoid floating-point errors
  const grossCents = Math.round(grossAmount * 100);
  const platformCents = Math.round(grossCents * commissionRate / 100);
  const gatewayCents = 0; // Reserved
  const teacherCents = grossCents - platformCents - gatewayCents;

  // Verify invariant
  if (platformCents + teacherCents + gatewayCents > grossCents) {
    throw new Error('Financial invariant violated: shares exceed gross');
  }

  return {
    grossAmount: grossCents / 100,
    platformShare: platformCents / 100,
    teacherShare: teacherCents / 100,
    gatewayFee: gatewayCents / 100,
    netAmount: teacherCents / 100,
    commissionRate,
    currency,
  };
}

/**
 * Ledger row shape (as returned by SELECT from financial_ledger).
 */
export interface LedgerRow {
  id: string;
  payment_id: string;
  order_id: string;
  student_id: string;
  subject_id: string;
  teacher_id: string;
  gateway_id: string | null;
  provider_payment_id: string;
  currency: string;
  gross_amount: number;
  platform_share: number;
  teacher_share: number;
  gateway_fee: number;
  net_amount: number;
  commission_rate: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Public-facing ledger metadata (no sensitive financial details).
 * Used when students/teachers view their own records.
 */
export interface LedgerMetadata {
  id: string;
  order_id: string;
  currency: string;
  gross_amount: number;
  status: string;
  created_at: string;
}

/**
 * Convert a LedgerRow to a safe public-facing metadata.
 * Strips platform_share, teacher_share, net_amount, commission_rate
 * (students shouldn't see these).
 */
export function toPublicMetadata(row: LedgerRow): LedgerMetadata {
  return {
    id: row.id,
    order_id: row.order_id,
    currency: row.currency,
    gross_amount: row.gross_amount,
    status: row.status,
    created_at: row.created_at,
  };
}
