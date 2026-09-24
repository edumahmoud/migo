-- =============================================================
-- v72_subscription_integrity.sql
-- AttenDo LMS — Enforce subscription period integrity at the DB level.
--
-- An enrollment with status='approved' MUST have all four period
-- fields set (current_period_start, current_period_end,
-- next_billing_at, monthly_price). This prevents any code path
-- (including direct DB manipulation) from creating an approved
-- enrollment without a valid billing period.
--
-- 'pending' and 'rejected' enrollments don't need period fields
-- (they're not active).
-- =============================================================

ALTER TABLE public.subject_students
  DROP CONSTRAINT IF EXISTS subject_students_period_required_check;

ALTER TABLE public.subject_students
  ADD CONSTRAINT subject_students_period_required_check
  CHECK (
    status != 'approved' OR (
      current_period_start IS NOT NULL AND
      current_period_end IS NOT NULL AND
      next_billing_at IS NOT NULL AND
      monthly_price IS NOT NULL
    )
  );
