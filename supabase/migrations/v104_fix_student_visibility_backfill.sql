-- =====================================================
-- v104: Fix student visibility — backfill enrollments + relax v72 constraint
-- =====================================================
-- ROOT CAUSE: When a student links to a teacher, the system only
-- updates teacher_student_links to 'approved'. It NEVER creates a
-- subject_students row. So students can't see course content.
--
-- Also: join-subject inserts status='pending' (not approved).
--
-- This migration:
--   0. Adds updated_at column if missing
--   1. RELAXES the v72 CHECK constraint
--   2. BACKFILLS: pending→approved, rejected→approved
--   3. BACKFILLS: creates missing subject_students for all approved links
--
-- Idempotent — safe to re-run.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 0. Add updated_at column if it doesn't exist
-- ─────────────────────────────────────────────────────
ALTER TABLE public.subject_students
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────
-- 1. Relax v72 CHECK constraint — allow permanent access
-- ─────────────────────────────────────────────────────
ALTER TABLE public.subject_students
  DROP CONSTRAINT IF EXISTS subject_students_period_required_check;

ALTER TABLE public.subject_students
  ADD CONSTRAINT subject_students_period_required_check
  CHECK (
    status != 'approved' OR (
      (current_period_start IS NOT NULL AND
       current_period_end IS NOT NULL AND
       next_billing_at IS NOT NULL AND
       monthly_price IS NOT NULL)
      OR
      current_period_end IS NULL
    )
  );

-- ─────────────────────────────────────────────────────
-- 2. Backfill: approve existing 'pending' enrollments
-- ─────────────────────────────────────────────────────
UPDATE public.subject_students
SET status = 'approved', updated_at = now()
WHERE status = 'pending';

UPDATE public.subject_students
SET status = 'approved', updated_at = now()
WHERE status = 'rejected';

-- ─────────────────────────────────────────────────────
-- 3. Backfill: for each approved teacher↔student link, create
--    missing subject_students rows for the teacher's subjects
-- ─────────────────────────────────────────────────────
INSERT INTO public.subject_students
  (subject_id, student_id, status, enrollment_method, enrolled_at)
SELECT
  s.id,
  tsl.student_id,
  'approved',
  'teacher_link',
  now()
FROM public.teacher_student_links tsl
JOIN public.subjects s ON s.teacher_id = tsl.teacher_id
WHERE tsl.status = 'approved'
ON CONFLICT (subject_id, student_id) DO NOTHING;

-- Done.
