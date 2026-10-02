-- =====================================================
-- v100: Ensure lesson_progress table + add estimated_minutes columns
-- =====================================================
-- Idempotent migration. If v63 was applied, the table exists — this is
-- a no-op. If v63 was skipped, this creates the table.
--
-- Also adds `estimated_minutes` to lesson_units (teacher enters expected
-- duration; shown to students in the unit header).
--
-- This migration enables Phase A of the LMS features roadmap:
--   - Lesson progress tracking (viewed / completed)
--   - Per-unit progress bar
--   - Overall course progress for students
--   - "Resume last lesson" feature
--   - Estimated time per unit
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. Ensure lesson_progress table exists (idempotent)
-- ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.lesson_units(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','failed','locked')),
  score INTEGER,
  max_score INTEGER,
  score_percentage DECIMAL(5,2),
  attempts INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  time_spent_sec INTEGER NOT NULL DEFAULT 0,
  last_position JSONB,
  failure_points JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_student ON public.lesson_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON public.lesson_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_subject ON public.lesson_progress(subject_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_unit ON public.lesson_progress(unit_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_status ON public.lesson_progress(status);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_student_lesson ON public.lesson_progress(student_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_student_subject ON public.lesson_progress(student_id, subject_id);

-- ─────────────────────────────────────────────────────
-- 2. Add estimated_minutes to lesson_units
-- ─────────────────────────────────────────────────────
-- Teacher enters expected duration (in minutes) for the unit.
-- Shown to students in the unit header. NULL = unknown.

ALTER TABLE public.lesson_units
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER
  CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0);

COMMENT ON COLUMN public.lesson_units.estimated_minutes IS
  'v100: Teacher-entered expected duration in minutes. NULL = unknown. Shown to students in the unit header for planning.';

-- ─────────────────────────────────────────────────────
-- 3. Add estimated_minutes to lessons (per-lesson, optional)
-- ─────────────────────────────────────────────────────

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER
  CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0);

COMMENT ON COLUMN public.lessons.estimated_minutes IS
  'v100: Optional estimated time to complete this lesson (in minutes). Used to compute unit-level estimates if unit.estimated_minutes is NULL.';

-- ─────────────────────────────────────────────────────
-- 4. RLS on lesson_progress (only owner can read; service_role bypasses)
-- ─────────────────────────────────────────────────────

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (idempotent re-run safe)
DROP POLICY IF EXISTS "Students can read own lesson progress" ON public.lesson_progress;
DROP POLICY IF EXISTS "Students can insert own lesson progress" ON public.lesson_progress;
DROP POLICY IF EXISTS "Students can update own lesson progress" ON public.lesson_progress;
DROP POLICY IF EXISTS "Teachers can read lesson progress" ON public.lesson_progress;

-- Students can read their own progress
CREATE POLICY "Students can read own lesson progress" ON public.lesson_progress
  FOR SELECT USING (auth.uid() = student_id);

-- Students can insert their own progress (no duplicates thanks to UNIQUE)
CREATE POLICY "Students can insert own lesson progress" ON public.lesson_progress
  FOR INSERT WITH CHECK (auth.uid() = student_id);

-- Students can update their own progress (e.g., mark complete)
CREATE POLICY "Students can update own lesson progress" ON public.lesson_progress
  FOR UPDATE USING (auth.uid() = student_id);

-- Note: Teachers reading student progress happens via the Next.js API
-- which uses the service_role client (bypasses RLS), so no teacher policy
-- is needed at the DB level.

-- ─────────────────────────────────────────────────────
-- 5. Updated_at trigger for lesson_progress
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_lesson_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  -- If status is being changed to 'completed' and completed_at is null, set it
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = now();
  END IF;
  -- If status is being changed away from 'completed', clear completed_at
  IF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lesson_progress_touch ON public.lesson_progress;
CREATE TRIGGER trg_lesson_progress_touch
  BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_lesson_progress_updated_at();

COMMENT ON FUNCTION public.touch_lesson_progress_updated_at() IS
  'v100: Auto-maintain updated_at + auto-set completed_at when status flips to completed.';

-- Done.
