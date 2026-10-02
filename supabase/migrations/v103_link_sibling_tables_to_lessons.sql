-- =====================================================
-- v103: Link sibling tables to lessons (relationships)
-- =====================================================
-- Adds `lesson_id` FK to existing tables that should reference
-- a specific lesson:
--   - assignments (lesson-level assignments, not just subject-level)
--   - subject_videos (videos that belong to a specific lesson)
--   - subject_files (files attached to a lesson)
--   - polls (lesson-embedded polls)
--   - summaries (lesson summaries)
--   - lectures (link a live lecture to a lesson)
--
-- Idempotent — uses ADD COLUMN IF NOT EXISTS + DO $$ for FKs.
-- Safe to re-run.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. assignments.lesson_id — link assignment to a specific lesson
-- ─────────────────────────────────────────────────────
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS lesson_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'assignments_lesson_id_fkey' AND table_name = 'assignments'
  ) THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'assignments.lesson_id FK: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignments_lesson ON public.assignments(lesson_id) WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.assignments.lesson_id IS
  'v103: Optional FK to a specific lesson. NULL = subject-level assignment.';

-- ─────────────────────────────────────────────────────
-- 2. subject_videos.lesson_id — link video to a specific lesson
-- ─────────────────────────────────────────────────────
ALTER TABLE public.subject_videos
  ADD COLUMN IF NOT EXISTS lesson_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subject_videos_lesson_id_fkey' AND table_name = 'subject_videos'
  ) THEN
    ALTER TABLE public.subject_videos
      ADD CONSTRAINT subject_videos_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'subject_videos.lesson_id FK: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_subject_videos_lesson ON public.subject_videos(lesson_id) WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.subject_videos.lesson_id IS
  'v103: Optional FK to a specific lesson. When set, the video is the primary video content for that lesson.';

-- ─────────────────────────────────────────────────────
-- 3. subject_files.lesson_id — link file to a specific lesson
-- ─────────────────────────────────────────────────────
ALTER TABLE public.subject_files
  ADD COLUMN IF NOT EXISTS lesson_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'subject_files_lesson_id_fkey' AND table_name = 'subject_files'
  ) THEN
    ALTER TABLE public.subject_files
      ADD CONSTRAINT subject_files_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'subject_files.lesson_id FK: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_subject_files_lesson ON public.subject_files(lesson_id) WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.subject_files.lesson_id IS
  'v103: Optional FK to a specific lesson. NULL = subject-level file (shown in Files tab). When set, file appears as an attachment to the lesson.';

-- ─────────────────────────────────────────────────────
-- 4. polls.lesson_id — link poll to a specific lesson
-- ─────────────────────────────────────────────────────
ALTER TABLE public.polls
  ADD COLUMN IF NOT EXISTS lesson_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'polls_lesson_id_fkey' AND table_name = 'polls'
  ) THEN
    ALTER TABLE public.polls
      ADD CONSTRAINT polls_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'polls.lesson_id FK: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_polls_lesson ON public.polls(lesson_id) WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.polls.lesson_id IS
  'v103: Optional FK to a specific lesson. NULL = subject-level poll.';

-- ─────────────────────────────────────────────────────
-- 5. summaries.lesson_id — link summary to a specific lesson
-- ─────────────────────────────────────────────────────
ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS lesson_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'summaries_lesson_id_fkey' AND table_name = 'summaries'
  ) THEN
    ALTER TABLE public.summaries
      ADD CONSTRAINT summaries_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'summaries.lesson_id FK: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_summaries_lesson ON public.summaries(lesson_id) WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.summaries.lesson_id IS
  'v103: Optional FK to a specific lesson. NULL = subject-level summary.';

-- ─────────────────────────────────────────────────────
-- 6. lectures.lesson_id — link live lecture to a lesson
-- ─────────────────────────────────────────────────────
ALTER TABLE public.lectures
  ADD COLUMN IF NOT EXISTS lesson_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lectures_lesson_id_fkey' AND table_name = 'lectures'
  ) THEN
    ALTER TABLE public.lectures
      ADD CONSTRAINT lectures_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'lectures.lesson_id FK: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_lectures_lesson ON public.lectures(lesson_id) WHERE lesson_id IS NOT NULL;

COMMENT ON COLUMN public.lectures.lesson_id IS
  'v103: Optional FK to a lesson. Allows a live lecture to be associated with a content lesson (e.g., lecture + notes).';

-- Done.
