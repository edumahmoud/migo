-- =====================================================
-- Examy - Subjects, Lectures & Notes Schema
-- =====================================================
-- ⚠️ WARNING: This file has RLS policies that cause infinite recursion!
-- Use FULL_SETUP.sql instead (which includes SECURITY DEFINER helper functions),
-- OR run v3_fix_rls_recursion.sql migration after this file to fix the recursion.
-- =====================================================

-- Subjects table
CREATE TABLE IF NOT EXISTS public.subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#10b981',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Subject-Students enrollment table
CREATE TABLE IF NOT EXISTS public.subject_students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(subject_id, student_id)
);

-- Lectures table
CREATE TABLE IF NOT EXISTS public.lectures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  lecture_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Lecture Notes table
CREATE TABLE IF NOT EXISTS public.lecture_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lecture_id UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subjects_teacher_id ON public.subjects(teacher_id);
CREATE INDEX IF NOT EXISTS idx_subject_students_subject_id ON public.subject_students(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_students_student_id ON public.subject_students(student_id);
CREATE INDEX IF NOT EXISTS idx_lectures_subject_id ON public.lectures(subject_id);
CREATE INDEX IF NOT EXISTS idx_lecture_notes_lecture_id ON public.lecture_notes(lecture_id);
CREATE INDEX IF NOT EXISTS idx_lecture_notes_user_id ON public.lecture_notes(user_id);

-- Enable RLS (idempotent)
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecture_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subjects
DROP POLICY IF EXISTS "Teachers can view own subjects" ON public.subjects;
CREATE POLICY "Teachers can view own subjects" ON public.subjects
  FOR SELECT USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students can view enrolled subjects" ON public.subjects;
CREATE POLICY "Students can view enrolled subjects" ON public.subjects
  FOR SELECT USING (
    id IN (SELECT subject_id FROM public.subject_students WHERE student_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can create subjects" ON public.subjects;
CREATE POLICY "Teachers can create subjects" ON public.subjects
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can update own subjects" ON public.subjects;
CREATE POLICY "Teachers can update own subjects" ON public.subjects
  FOR UPDATE USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can delete own subjects" ON public.subjects;
CREATE POLICY "Teachers can delete own subjects" ON public.subjects
  FOR DELETE USING (teacher_id = auth.uid());

-- RLS Policies for subject_students
DROP POLICY IF EXISTS "Teachers can view enrollments in their subjects" ON public.subject_students;
CREATE POLICY "Teachers can view enrollments in their subjects" ON public.subject_students
  FOR SELECT USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Students can view own enrollments" ON public.subject_students;
CREATE POLICY "Students can view own enrollments" ON public.subject_students
  FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can enroll students" ON public.subject_students;
CREATE POLICY "Teachers can enroll students" ON public.subject_students
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can remove students" ON public.subject_students;
CREATE POLICY "Teachers can remove students" ON public.subject_students
  FOR DELETE USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

-- RLS Policies for lectures
DROP POLICY IF EXISTS "Teachers can view lectures in own subjects" ON public.lectures;
CREATE POLICY "Teachers can view lectures in own subjects" ON public.lectures
  FOR SELECT USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Students can view lectures in enrolled subjects" ON public.lectures;
CREATE POLICY "Students can view lectures in enrolled subjects" ON public.lectures
  FOR SELECT USING (
    subject_id IN (SELECT subject_id FROM public.subject_students WHERE student_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can create lectures" ON public.lectures;
CREATE POLICY "Teachers can create lectures" ON public.lectures
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can update lectures" ON public.lectures;
CREATE POLICY "Teachers can update lectures" ON public.lectures
  FOR UPDATE USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can delete lectures" ON public.lectures;
CREATE POLICY "Teachers can delete lectures" ON public.lectures
  FOR DELETE USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

-- RLS Policies for lecture_notes
DROP POLICY IF EXISTS "Teachers can view all notes in their subjects" ON public.lecture_notes;
CREATE POLICY "Teachers can view all notes in their subjects" ON public.lecture_notes
  FOR SELECT USING (
    lecture_id IN (
      SELECT l.id FROM public.lectures l
      JOIN public.subjects s ON l.subject_id = s.id
      WHERE s.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Students can view public notes in enrolled subjects" ON public.lecture_notes;
CREATE POLICY "Students can view public notes in enrolled subjects" ON public.lecture_notes
  FOR SELECT USING (
    (visibility = 'public' AND lecture_id IN (
      SELECT l.id FROM public.lectures l
      JOIN public.subject_students ss ON l.subject_id = ss.subject_id
      WHERE ss.student_id = auth.uid()
    )) OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Users can create notes" ON public.lecture_notes;
CREATE POLICY "Users can create notes" ON public.lecture_notes
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notes" ON public.lecture_notes;
CREATE POLICY "Users can update own notes" ON public.lecture_notes
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own notes" ON public.lecture_notes;
CREATE POLICY "Users can delete own notes" ON public.lecture_notes
  FOR DELETE USING (user_id = auth.uid());

-- Grant permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Enable realtime (idempotent - will fail silently if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lecture_notes;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lectures;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_students;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
