/**
 * Per-Teacher Commission Resolver — v111
 *
 * Looks up the effective platform commission percentage for a given
 * teacher. Resolution order:
 *
 *   1. users.commission_percentage (per-teacher override)
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
 *   - Changing users.commission_percentage today does NOT recalculate
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
 */

import { supabaseServer } from '@/lib/supabase-server';

export interface CommissionResolution {
  /** Effective commission percentage (0-100). */
  rate: number;
  /** Where the rate came from. */
  source: 'per_teacher' | 'global' | 'default_zero';
  /**
   * True if the per-teacher override was used (rate from
   * users.commission_percentage). False if the global rate or 0 fallback
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
  // 1) Per-teacher override
  if (teacherId) {
    const { data: teacherRow, error } = await supabaseServer
      .from('users')
      .select('commission_percentage')
      .eq('id', teacherId)
      .maybeSingle();

    if (error) {
      // Log but continue — fall back to global rate.
      console.warn('[commission] per-teacher lookup failed', {
        teacherId,
        error: error.message,
      });
    } else {
      const perTeacherRate = (teacherRow as { commission_percentage: number | null } | null)
        ?.commission_percentage;
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

/**
 * Convenience: pure helper to compute platform_share + teacher_share
 * given a gross amount + commission rate. Mirrors the SQL ROUND(...,2)
 * arithmetic used inside the activate_subscription_after_payment RPC.
 *
 * All inputs/outputs are in major units (EGP).
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
