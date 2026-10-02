-- =====================================================
-- v102: Lesson entity — full LMS feature parity
-- =====================================================
-- Adds 13 missing columns to public.lessons + creates 6 new tables:
--   lesson_attachments, lesson_notes, lesson_bookmarks,
--   lesson_discussions, lesson_versions, lesson_translations
--
-- Idempotent — uses ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS.
-- Safe to re-run.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- PART 1: New columns on public.lessons
-- ─────────────────────────────────────────────────────

ALTER TABLE public.lessons
  -- Video support (#1): either an external URL or a link to subject_videos
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS video_id UUID,  -- FK added below (after column exists)
  -- Summary + objectives (#3, #4): abstract + learning goals
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Scheduling (#5): due date + availability window
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS available_until TIMESTAMPTZ,
  -- Prerequisite gating (#6): next-lesson sequential unlock
  ADD COLUMN IF NOT EXISTS prerequisite_lesson_id UUID,  -- FK added below
  -- Actual duration (#7): computed from video length or text length
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  -- Tags (#19): for search + categorization
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  -- Free preview (#24): visible to non-enrolled students
  ADD COLUMN IF NOT EXISTS is_free_preview BOOLEAN NOT NULL DEFAULT false,
  -- Instructor-only notes (#25): private to teachers
  ADD COLUMN IF NOT EXISTS instructor_notes TEXT,
  -- Transcript (#18): searchable video transcript
  ADD COLUMN IF NOT EXISTS transcript TEXT;

-- Add foreign keys (separate so they don't fail on first run if column exists but FK doesn't)
DO $$
BEGIN
  -- video_id → subject_videos
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lessons_video_id_fkey' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE public.lessons
      ADD CONSTRAINT lessons_video_id_fkey
      FOREIGN KEY (video_id) REFERENCES public.subject_videos(id) ON DELETE SET NULL;
  END IF;

  -- prerequisite_lesson_id → lessons (self-reference)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lessons_prerequisite_lesson_id_fkey' AND table_name = 'lessons'
  ) THEN
    ALTER TABLE public.lessons
      ADD CONSTRAINT lessons_prerequisite_lesson_id_fkey
      FOREIGN KEY (prerequisite_lesson_id) REFERENCES public.lessons(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK creation skipped: %', SQLERRM;
END $$;

COMMENT ON COLUMN public.lessons.video_url IS 'v102: Optional external video URL (YouTube/Vimeo/direct MP4). Used if video_id is null.';
COMMENT ON COLUMN public.lessons.video_id IS 'v102: Optional FK to subject_videos. When set, the video is the primary content of the lesson.';
COMMENT ON COLUMN public.lessons.summary IS 'v102: Short abstract shown above the lesson content (1-3 sentences).';
COMMENT ON COLUMN public.lessons.objectives IS 'v102: Array of learning objective strings. Shown as bullet points under the summary.';
COMMENT ON COLUMN public.lessons.due_date IS 'v102: Optional due date. After this date, students can still view but it appears overdue in their dashboard.';
COMMENT ON COLUMN public.lessons.available_from IS 'v102: Optional — lesson is hidden from students until this timestamp.';
COMMENT ON COLUMN public.lessons.available_until IS 'v102: Optional — lesson is hidden from students after this timestamp.';
COMMENT ON COLUMN public.lessons.prerequisite_lesson_id IS 'v102: Optional self-FK to another lesson. Students must complete this prereq before the lesson unlocks.';
COMMENT ON COLUMN public.lessons.duration_seconds IS 'v102: Optional computed duration in seconds (from video length, or estimated from text).';
COMMENT ON COLUMN public.lessons.tags IS 'v102: Array of free-text tags for search + categorization.';
COMMENT ON COLUMN public.lessons.is_free_preview IS 'v102: When true, non-enrolled students can preview this lesson (Udemy-style free preview).';
COMMENT ON COLUMN public.lessons.instructor_notes IS 'v102: Private notes visible to teachers/admins only. Never shown to students.';
COMMENT ON COLUMN public.lessons.transcript IS 'v102: Optional searchable transcript text (for video lessons).';

-- ─────────────────────────────────────────────────────
-- PART 2: lesson_attachments (#2) — link files to lessons
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  subject_file_id UUID REFERENCES public.subject_files(id) ON DELETE CASCADE,
  -- Allow external URL attachments (not in subject_files) too
  external_url TEXT,
  external_name TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_attachments_lesson ON public.lesson_attachments(lesson_id, display_order);
CREATE INDEX IF NOT EXISTS idx_lesson_attachments_file ON public.lesson_attachments(subject_file_id);

ALTER TABLE public.lesson_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers manage lesson attachments" ON public.lesson_attachments;
DROP POLICY IF EXISTS "Students read lesson attachments" ON public.lesson_attachments;
CREATE POLICY "Teachers manage lesson attachments" ON public.lesson_attachments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND (
      l.created_by = auth.uid() OR
      EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = l.subject_id AND s.teacher_id = auth.uid())
    ))
  );
CREATE POLICY "Students read lesson attachments" ON public.lesson_attachments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND l.status = 'published')
  );

-- ─────────────────────────────────────────────────────
-- PART 3: lesson_notes (#15) — student inline notes per lesson
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  -- Optional: timestamp/position in the video where the note was taken
  position_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_notes_student ON public.lesson_notes(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_notes_lesson ON public.lesson_notes(lesson_id);

ALTER TABLE public.lesson_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students read own notes" ON public.lesson_notes;
DROP POLICY IF EXISTS "Students write own notes" ON public.lesson_notes;
CREATE POLICY "Students read own notes" ON public.lesson_notes
  FOR SELECT USING (auth.uid() = student_id);
CREATE POLICY "Students write own notes" ON public.lesson_notes
  FOR ALL USING (auth.uid() = student_id);

CREATE OR REPLACE FUNCTION public.touch_lesson_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_lesson_notes_touch ON public.lesson_notes;
CREATE TRIGGER trg_lesson_notes_touch BEFORE UPDATE ON public.lesson_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_lesson_notes_updated_at();

-- ─────────────────────────────────────────────────────
-- PART 4: lesson_bookmarks (#16) — student bookmarks at positions
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label TEXT,
  position_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_bookmarks_student ON public.lesson_bookmarks(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_bookmarks_lesson ON public.lesson_bookmarks(lesson_id);

ALTER TABLE public.lesson_bookmarks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students manage own bookmarks" ON public.lesson_bookmarks;
CREATE POLICY "Students manage own bookmarks" ON public.lesson_bookmarks
  FOR ALL USING (auth.uid() = student_id);

-- ─────────────────────────────────────────────────────
-- PART 5: lesson_discussions (#17) — threaded discussions per lesson
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.lesson_discussions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_discussions_lesson ON public.lesson_discussions(lesson_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_discussions_parent ON public.lesson_discussions(parent_id);

ALTER TABLE public.lesson_discussions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read discussions" ON public.lesson_discussions;
DROP POLICY IF EXISTS "Authenticated can post discussions" ON public.lesson_discussions;
DROP POLICY IF EXISTS "Users update own discussions" ON public.lesson_discussions;
CREATE POLICY "Authenticated can read discussions" ON public.lesson_discussions
  FOR SELECT USING (true);  -- visible to anyone authenticated (enrollment checked at API layer)
CREATE POLICY "Authenticated can post discussions" ON public.lesson_discussions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own discussions" ON public.lesson_discussions
  FOR UPDATE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────
-- PART 6: lesson_versions (#21) — content versioning for rollback
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_json JSONB,
  content_html TEXT,
  saved_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lesson_versions_lesson ON public.lesson_versions(lesson_id, version DESC);

ALTER TABLE public.lesson_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers read lesson versions" ON public.lesson_versions;
DROP POLICY IF EXISTS "Teachers write lesson versions" ON public.lesson_versions;
CREATE POLICY "Teachers read lesson versions" ON public.lesson_versions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND (
      l.created_by = auth.uid() OR
      EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = l.subject_id AND s.teacher_id = auth.uid())
    ))
  );
CREATE POLICY "Teachers write lesson versions" ON public.lesson_versions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND (
      l.created_by = auth.uid() OR
      EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = l.subject_id AND s.teacher_id = auth.uid())
    ))
  );

-- ─────────────────────────────────────────────────────
-- PART 7: lesson_translations (#22) — multilingual content
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lesson_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,  -- e.g. 'ar', 'en', 'fr'
  title TEXT NOT NULL,
  summary TEXT,
  content_json JSONB,
  content_html TEXT,
  translated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_lesson_translations_lesson ON public.lesson_translations(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_translations_locale ON public.lesson_translations(locale);

ALTER TABLE public.lesson_translations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teachers manage translations" ON public.lesson_translations;
CREATE POLICY "Teachers manage translations" ON public.lesson_translations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.lessons l WHERE l.id = lesson_id AND (
      l.created_by = auth.uid() OR
      EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = l.subject_id AND s.teacher_id = auth.uid())
    ))
  );

-- Done.
