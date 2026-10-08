-- =============================================================
-- v115_student_suspensions.sql
-- AttenDo LMS — Student suspend/activate (global + per-course).
--
-- Background:
--   Task 3 requires:
--     - A teacher/admin can suspend a student globally OR per-course.
--     - Optional duration: expires_at, after which the suspension
--       auto-lifts (a scheduled check or on-demand check).
--     - A lifted_at timestamp is recorded for audit.
--     - A reason is recorded.
--
-- Design:
--   * New table `student_suspensions` carries one row per suspension
--     event. Active = is_active=true AND (expires_at IS NULL OR
--     expires_at > now()).
--   * scope='global' (subject_id NULL) blocks platform access.
--   * scope='course' (subject_id NOT NULL) blocks a single course.
--   * Multiple active suspensions for the same student/subject are
--     prevented by a partial unique index.
--   * RLS:
--       - Students can SELECT their own suspensions.
--       - Teachers can SELECT suspensions for students enrolled in
--         their subjects.
--       - Teachers can INSERT/UPDATE suspensions for students
--         enrolled in their subjects (scope='course' only).
--       - Admins have full access.
--
-- This migration ONLY adds the table. No existing data is touched.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.student_suspensions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id    UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL CHECK (scope IN ('global', 'course')),
  reason        TEXT,
  suspended_by  UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  suspended_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  lifted_at     TIMESTAMPTZ,
  lifted_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT suspensions_scope_consistency
    CHECK (
      (scope = 'global'  AND subject_id IS NULL) OR
      (scope = 'course'  AND subject_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_ss_student
  ON public.student_suspensions(student_id);
CREATE INDEX IF NOT EXISTS idx_ss_subject
  ON public.student_suspensions(subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ss_active
  ON public.student_suspensions(student_id, subject_id, is_active, expires_at)
  WHERE is_active = TRUE;

-- One active suspension per (student, scope, subject) combination.
-- A new suspension can be created only after the previous one is lifted.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ss_active_per_scope
  ON public.student_suspensions(student_id, scope, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active = TRUE;

ALTER TABLE public.student_suspensions ENABLE ROW LEVEL SECURITY;

-- Students can read their own suspensions.
DROP POLICY IF EXISTS ss_student_self_read ON public.student_suspensions;
CREATE POLICY ss_student_self_read
  ON public.student_suspensions FOR SELECT
  USING (student_id = auth.uid());

-- Teachers can read suspensions for students enrolled in their subjects.
-- (Subject-level join via subject_id, OR scope='global' rows when the
--  student is enrolled in any of the teacher's subjects.)
DROP POLICY IF EXISTS ss_teacher_read ON public.student_suspensions;
CREATE POLICY ss_teacher_read
  ON public.student_suspensions FOR SELECT
  USING (
    suspended_by = auth.uid()
    OR subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
    OR (
      scope = 'global' AND student_id IN (
        SELECT student_id FROM public.subject_students
        WHERE subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
      )
    )
  );

-- Teachers can INSERT/UPDATE suspensions for students enrolled in
-- their own subjects (scope='course' only — teachers cannot issue
-- global suspensions; that's admin-only).
DROP POLICY IF EXISTS ss_teacher_modify ON public.student_suspensions;
CREATE POLICY ss_teacher_modify
  ON public.student_suspensions FOR ALL
  USING (
    scope = 'course'
    AND subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
    AND student_id IN (
      SELECT student_id FROM public.subject_students
      WHERE subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
    )
  )
  WITH CHECK (
    scope = 'course'
    AND subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
    AND student_id IN (
      SELECT student_id FROM public.subject_students
      WHERE subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
    )
  );

-- Admins have full access.
DROP POLICY IF EXISTS ss_admin_all ON public.student_suspensions;
CREATE POLICY ss_admin_all
  ON public.student_suspensions FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Optional: add to realtime
ALTER PUBLICATION supabase_realtime SET TABLE public.student_suspensions;

COMMENT ON TABLE public.student_suspensions IS
  'Student suspension events. Active rows (is_active=true AND (expires_at IS NULL OR expires_at > now())) enforce access denial.';
