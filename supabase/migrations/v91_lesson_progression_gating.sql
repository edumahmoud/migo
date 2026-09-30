-- =====================================================
-- v91: Lesson progression gating — teacher-set threshold
-- =====================================================
-- GOAL: allow teachers to enforce sequential lesson completion
-- before a student can access the next lesson.
--
-- Adds a subject-level toggle: when TRUE, students must complete
-- each published lesson (in order_index) before they can open
-- the next one. Completion is defined by the lesson's
-- pass_threshold (already exists from v63) — the student must
-- achieve >= pass_threshold% on the lesson_progress.
--
-- Schema changes:
--   - subjects.lesson_progression_enabled BOOLEAN (default false)
--   - subjects.default_progress_threshold INTEGER (default 100,
--     0-100 — used when a lesson has no per-lesson pass_threshold)
--   - new index on lesson_progress(student_id, lesson_id, status)
--     for fast gate-check queries
-- =====================================================

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS lesson_progression_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS default_progress_threshold INTEGER NOT NULL DEFAULT 100
    CHECK (default_progress_threshold BETWEEN 0 AND 100);

-- Partial index — only 'completed' rows are interesting for the gate check.
-- This makes the query "has student completed lesson X?" O(log N) instead
-- of O(N) on the full table.
CREATE INDEX IF NOT EXISTS idx_lesson_progress_completed
  ON public.lesson_progress(student_id, lesson_id, status)
  WHERE status = 'completed';

COMMENT ON COLUMN public.subjects.lesson_progression_enabled IS
  'When TRUE, students must complete each published lesson (in order_index ASC) before they can access the next one. Default FALSE — free navigation is the existing behavior.';

COMMENT ON COLUMN public.subjects.default_progress_threshold IS
  'Default pass_threshold percentage (0-100) used when a lesson has no per-lesson pass_threshold set. Default 100 = must be fully completed.';
