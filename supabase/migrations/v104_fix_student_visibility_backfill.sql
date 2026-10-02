-- =====================================================
-- v104: Fix student visibility — backfill enrollments + relax v72 constraint
-- =====================================================
-- ROOT CAUSE: When a student links to a teacher (via link-teacher,
-- link-teacher-approve, link-teacher-send), the system only updates
-- teacher_student_links to 'approved'. It NEVER creates a
-- subject_students row. So when the student opens a course:
--   GET /api/lessons → checks subject_students → no row → 403 → empty content
--
-- Also: join-subject inserts status='pending' (not approved),
-- so even direct joins don't show content until manual approval.
--
-- v92 only backfilled teacher_student_links, not subject_students.
--
-- This migration:
--   1. RELAXES the v72 CHECK constraint to allow status='approved'
--      with NULL period_end (permanent access for free/linked courses)
--   2. BACKFILLS: for every approved (teacher, student) link,
--      INSERT missing subject_students rows for all the teacher's subjects
--      with status='approved' + permanent access (NULL period_end)
--   3. BACKFILLS: UPDATE existing 'pending' subject_students rows
--      to 'approved' (so join-subject users see content immediately)
--   4. UPDATE existing 'rejected' rows to 'approved' (cleanup —
--      v92 made the approval flow deprecated)
--
-- Idempotent — safe to re-run.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Relax v72 CHECK constraint — allow permanent access
-- ─────────────────────────────────────────────────────
-- v72 required ALL 4 period fields to be set when status='approved'.
-- This blocked permanent access (NULL period_end) for free/linked
-- courses. We relax it to: if status='approved', EITHER all 4 fields
-- are set (monthly sub) OR period_end IS NULL (permanent access).
ALTER TABLE public.subject_students
  DROP CONSTRAINT IF EXISTS subject_students_period_required_check;

ALTER TABLE public.subject_students
  ADD CONSTRAINT subject_students_period_required_check
  CHECK (
    status != 'approved' OR (
      -- Monthly subscription: all 4 fields set
      (current_period_start IS NOT NULL AND
       current_period_end IS NOT NULL AND
       next_billing_at IS NOT NULL AND
       monthly_price IS NOT NULL)
      OR
      -- Permanent access: period_end IS NULL (free/linked/agent)
      current_period_end IS NULL
    )
  );

-- ─────────────────────────────────────────────────────
-- 2. Backfill: approve existing 'pending' enrollments
-- ─────────────────────────────────────────────────────
-- Students who joined via join-subject (status='pending') get
-- auto-approved so they can see content immediately.
UPDATE public.subject_students
SET status = 'approved',
    updated_at = now()
WHERE status = 'pending';

-- Also clean up 'rejected' rows (v92 deprecated the rejection flow)
UPDATE public.subject_students
SET status = 'approved',
    updated_at = now()
WHERE status = 'rejected';

-- ─────────────────────────────────────────────────────
-- 3. Backfill: for each approved teacher↔student link, create
--    missing subject_students rows for the teacher's subjects
-- ─────────────────────────────────────────────────────
-- This is the BIG FIX. Students linked to a teacher get enrolled
-- in ALL the teacher's subjects with permanent access (NULL period_end).
-- Uses ON CONFLICT DO NOTHING to be idempotent.

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

-- ─────────────────────────────────────────────────────
-- 4. Update get_student_subject_ids() to allow permanent access
-- ─────────────────────────────────────────────────────
-- The v70 version of this function returns rows where:
--   status = 'approved' AND (current_period_end IS NULL OR > now())
-- This is already correct — no change needed. Just re-affirming.

COMMENT ON TABLE public.subject_students IS
  'v104: relaxed v72 CHECK constraint to allow permanent access (NULL period_end) for approved enrollments. Backfilled: pending→approved, rejected→approved, and created missing subject_students rows for all approved teacher↔student links.';

-- Done.
-- Verify:
--   SELECT status, COUNT(*) FROM subject_students GROUP BY status;
--   -- Should show only 'approved'
--   SELECT COUNT(*) FROM subject_students WHERE status != 'approved';
--   -- Should be 0
