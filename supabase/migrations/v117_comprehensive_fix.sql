-- =====================================================
-- v117: Comprehensive fix migration — Migo educational platform
-- =====================================================
-- GOAL: fix 4 user-reported + discovered issues in one migration.
--
--   P1. Seed default monthly subscription plans for ALL subjects that
--       don't have any subject_subscription_plans rows yet. Before this
--       fix, students on the activation page saw "no plans available"
--       for legacy courses created before v113, even though the API
--       silently fell back to subject.price.
--
--   P2. Seed a 0% platform_commission row in fee_catalog IF the table
--       is empty. Before this, if the admin never configured any fees,
--       the order creation code passed an empty fee_rows array to
--       calculateFees(), which returned fees_total=0 + an empty
--       fees_breakdown → the student's payment dialog showed "+0.00"
--       with no breakdown at all.
--
--   P5. Re-assert that users.commission_rate is the ONLY per-teacher
--       commission column (v112 contract). Drop the FORBIDDEN
--       users.commission_percentage column if it exists (added by
--       v111 migration that was superseded by v112). Copy any non-NULL
--       values from commission_percentage → commission_rate first so
--       no admin-set rates are lost.
--
--   P5b. Backfill orders.base_amount / fees_total / grand_total for
--       legacy orders that have order_fees rows but NULL
--       base_amount/fees_total/grand_total columns. This makes the
--       payment dialog show the correct breakdown instead of "0".
--
-- This migration is FULLY IDEMPOTENT:
--   - Uses IF NOT EXISTS / ON CONFLICT DO NOTHING
--   - Uses COALESCE to avoid overwriting non-NULL values
--   - Re-running it has no effect
--
-- HISTORICAL DATA SAFETY (absolute requirement):
--   - Existing financial_ledger rows are NEVER modified.
--   - Existing subject_subscription_plans rows are NEVER modified.
--   - Existing fee_catalog rows are NEVER modified (only inserted if missing).
--   - Existing orders.* columns are NEVER overwritten (only backfilled when NULL).
--   - The users.commission_percentage column is dropped ONLY after its
--     non-NULL values are copied to users.commission_rate (which is
--     the column the application actually reads).
-- =====================================================

BEGIN;

-- ───────────────────────────────────────────────────────
-- P1: Seed default monthly plans for subjects with no plans
-- ───────────────────────────────────────────────────────
-- For every subject that has ZERO rows in subject_subscription_plans,
-- insert a single monthly plan with price = subjects.price and
-- duration_days = 30. This makes the activation page plan selector
-- show up correctly (one real plan instead of a synthetic fallback).

INSERT INTO public.subject_subscription_plans (
  subject_id, period_type, period_label, duration_days,
  price, currency, is_active, sort_order, created_at, updated_at
)
SELECT
  s.id,
  'monthly' AS period_type,
  '' AS period_label,
  30 AS duration_days,
  COALESCE(s.price, 0) AS price,
  COALESCE(s.currency, 'EGP') AS currency,
  true AS is_active,
  0 AS sort_order,
  now() AS created_at,
  now() AS updated_at
FROM public.subjects s
WHERE NOT EXISTS (
  SELECT 1 FROM public.subject_subscription_plans p
  WHERE p.subject_id = s.id
);

-- ───────────────────────────────────────────────────────
-- P2: Seed default fee_catalog rows if the table is empty
-- ───────────────────────────────────────────────────────
-- Insert a 0% platform_commission row IF AND ONLY IF the table has
-- no rows at all. This ensures the order creation code always finds
-- at least one active fee → calculateFees() returns a non-empty
-- breakdown → the payment dialog shows a real row instead of "+0.00".

INSERT INTO public.fee_catalog (code, name_ar, name_en, description, fee_kind, value, is_active, effective_from, sort_order)
SELECT
  'platform_commission' AS code,
  'عمولة المنصة' AS name_ar,
  'Platform Commission' AS name_en,
  'Platform commission percentage added on top of the subscription total. Edit this value in the admin fee catalog to set the actual percentage.' AS description,
  'percentage' AS fee_kind,
  0 AS value,
  true AS is_active,
  now() AS effective_from,
  0 AS sort_order
WHERE NOT EXISTS (SELECT 1 FROM public.fee_catalog LIMIT 1);

-- ───────────────────────────────────────────────────────
-- P5: Re-assert users.commission_rate as the SOLE per-teacher column
-- ───────────────────────────────────────────────────────
-- v111 introduced users.commission_percentage.
-- v112 corrected this to users.commission_rate and FORBIDS the use
-- of commission_percentage. However, v112 only added commission_rate
-- with ADD COLUMN IF NOT EXISTS — it did NOT drop commission_percentage
-- or migrate values. This left a footgun: if v111 was applied and the
-- admin set per-teacher rates via the v111 PATCH endpoint (which wrote
-- to commission_percentage), those rates would be silently ignored
-- because the v112 application code reads commission_rate.

-- Step 1: ensure users.commission_rate exists (idempotent — v112 already did this)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2)
  CHECK (commission_rate IS NULL
         OR (commission_rate >= 0 AND commission_rate <= 100));

-- Step 2: copy any non-NULL values from commission_percentage → commission_rate
-- (only where commission_rate IS NULL, so we never overwrite an existing value)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'commission_percentage'
  ) THEN
    UPDATE public.users
      SET commission_rate = commission_percentage
      WHERE commission_percentage IS NOT NULL
        AND commission_rate IS NULL;
    RAISE NOTICE 'Migrated commission_percentage → commission_rate for % rows',
      (SELECT COUNT(*) FROM public.users WHERE commission_percentage IS NOT NULL);
  END IF;
END $$;

-- Step 3: drop the FORBIDDEN commission_percentage column if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'commission_percentage'
  ) THEN
    ALTER TABLE public.users DROP COLUMN commission_percentage;
    RAISE NOTICE 'Dropped FORBIDDEN column users.commission_percentage';
  END IF;
END $$;

-- Step 4: re-create the partial index on commission_rate (idempotent)
CREATE INDEX IF NOT EXISTS idx_users_commission_rate
  ON public.users(commission_rate)
  WHERE commission_rate IS NOT NULL;

-- ───────────────────────────────────────────────────────
-- P5b: Backfill orders.base_amount / fees_total / grand_total
-- ───────────────────────────────────────────────────────
-- Some orders created before v88 (or by code paths that bypassed the
-- fees-on-top INSERT) have NULL base_amount/fees_total/grand_total
-- even though order_fees rows exist for them. Backfill:
--   - If order_fees rows exist AND base_amount IS NULL:
--       base_amount = orders.amount - SUM(order_fees.calculated_amount)
--       fees_total  = SUM(order_fees.calculated_amount)
--       grand_total = orders.amount
--   - If NO order_fees rows exist (genuine pre-v88):
--       base_amount = orders.amount
--       fees_total  = 0
--       grand_total = orders.amount
-- This makes the GET /api/student/orders/[id] endpoint return the
-- correct breakdown without needing the in-route backfill logic
-- (which only fires at read-time — this fixes the source rows).

-- Backfill: orders with order_fees rows but NULL base_amount
UPDATE public.orders o
  SET
    base_amount = COALESCE(o.base_amount,
      o.amount - COALESCE((SELECT SUM(f.calculated_amount) FROM public.order_fees f WHERE f.order_id = o.id), 0)),
    fees_total = COALESCE(o.fees_total,
      COALESCE((SELECT SUM(f.calculated_amount) FROM public.order_fees f WHERE f.order_id = o.id), 0)),
    grand_total = COALESCE(o.grand_total, o.amount)
WHERE o.base_amount IS NULL
  AND EXISTS (SELECT 1 FROM public.order_fees f WHERE f.order_id = o.id);

-- Backfill: orders with NO order_fees rows but NULL base_amount (genuine pre-v88)
UPDATE public.orders o
  SET
    base_amount = COALESCE(o.base_amount, o.amount),
    fees_total = COALESCE(o.fees_total, 0),
    grand_total = COALESCE(o.grand_total, o.amount)
WHERE o.base_amount IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.order_fees f WHERE f.order_id = o.id);

-- ───────────────────────────────────────────────────────
-- Done.
-- ───────────────────────────────────────────────────────

COMMIT;

-- =====================================================
-- Verification queries (run manually after applying):
-- =====================================================
-- -- P1: subjects WITHOUT subscription plans (should be 0)
-- SELECT COUNT(*) AS subjects_without_plans
--   FROM public.subjects s
--   WHERE NOT EXISTS (SELECT 1 FROM public.subject_subscription_plans p WHERE p.subject_id = s.id);
--
-- -- P2: fee_catalog row count (should be >= 1)
-- SELECT COUNT(*) AS fee_catalog_count, STRING_AGG(code, ', ') AS codes FROM public.fee_catalog;
--
-- -- P5: ensure commission_percentage is GONE (should be 0)
-- SELECT COUNT(*) AS forbidden_column_count
--   FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'commission_percentage';
--
-- -- P5: per-teacher rates that were migrated
-- SELECT id, name, commission_rate FROM public.users
--   WHERE commission_rate IS NOT NULL AND role = 'teacher';
--
-- -- P5b: orders still missing base_amount (should be 0)
-- SELECT COUNT(*) AS orders_missing_base_amount
--   FROM public.orders WHERE base_amount IS NULL;
-- =====================================================
