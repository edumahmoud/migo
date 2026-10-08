-- =====================================================
-- v105: Remove v104 backfill enrollments that were too aggressive
-- =====================================================
-- v104 auto-enrolled students in ALL their teacher's subjects
-- (enrollment_method='teacher_add', no period fields).
-- This caused students to see courses they're NOT subscribed to
-- with "دائم" (permanent) label.
--
-- This migration removes ONLY the v104-created rows (identified by
-- enrollment_method='teacher_add' AND all period fields NULL).
-- Legitimate 'teacher_add' enrollments (from agent/register-student)
-- set all 4 period fields, so they're NOT affected.
--
-- Legitimate enrollments (self_paid, self_join, agent_register)
-- are also NOT affected.
-- =====================================================

-- Remove v104 backfill rows: teacher_add with NO period fields
DELETE FROM public.subject_students
WHERE enrollment_method = 'teacher_add'
  AND current_period_start IS NULL
  AND current_period_end IS NULL
  AND next_billing_at IS NULL
  AND monthly_price IS NULL;

-- Done.
-- Verify:
--   SELECT enrollment_method, COUNT(*) FROM subject_students GROUP BY enrollment_method;
