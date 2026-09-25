-- =============================================================
-- v71_unified_monthly_subscriptions.sql
-- AttenDo LMS — Unify monthly subscription model across ALL
-- enrollment types (agent-registered, self-join, teacher-add, self-paid).
--
-- Before v71: only 'self_paid' enrollments had billing periods.
-- Agent-registered / self-join / teacher_add had NULL period_end
-- → permanent access.
--
-- After v71: ALL enrollments are monthly. NULL period_end is no
-- longer treated as permanent — it's treated as expired.
--
-- Existing enrollments with NULL period_end get a 1-month grace
-- period from the migration date (backfilled to now + 1 month).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Backfill: give all existing NULL-period enrollments a
--    1-month grace period from the migration date.
-- -------------------------------------------------------------
UPDATE public.subject_students
SET
  current_period_start = COALESCE(current_period_start, now()),
  current_period_end   = COALESCE(current_period_end, now() + interval '1 month'),
  next_billing_at      = COALESCE(next_billing_at, now() + interval '1 month')
WHERE current_period_end IS NULL;

-- -------------------------------------------------------------
-- 2. Update get_student_subject_ids() — remove the IS NULL exception.
--    ALL enrollments must have current_period_end > now() for access.
--    NULL or expired → excluded → student loses course content access.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_student_subject_ids(student_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT subject_id FROM public.subject_students
  WHERE student_id = get_student_subject_ids.student_id
    AND status = 'approved'
    AND current_period_end IS NOT NULL
    AND current_period_end > now();
$$;

GRANT EXECUTE ON FUNCTION public.get_student_subject_ids(UUID) TO authenticated, anon;

-- -------------------------------------------------------------
-- 3. Update the index to drop the partial-NULL clause
--    (now ALL rows have a non-NULL period_end).
-- =============================================================
DROP INDEX IF EXISTS idx_subject_students_period_end;
CREATE INDEX idx_subject_students_period_end
  ON public.subject_students(student_id, current_period_end);
