-- =====================================================
-- v10: Add subject_teachers junction table
-- Allows multiple teachers to be associated with the same course
-- =====================================================

-- 1. Create the subject_teachers junction table
CREATE TABLE IF NOT EXISTS public.subject_teachers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'co_teacher' CHECK (role IN ('owner', 'co_teacher')),
  added_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(subject_id, teacher_id)
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_subject_teachers_subject_id ON public.subject_teachers(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_teachers_teacher_id ON public.subject_teachers(teacher_id);
CREATE INDEX IF NOT EXISTS idx_subject_teachers_role ON public.subject_teachers(role);

-- 3. Enable RLS
ALTER TABLE public.subject_teachers ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for subject_teachers
CREATE POLICY "Teachers can view co-teachers in their subjects" ON public.subject_teachers
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can view own co-teacher entries" ON public.subject_teachers
  FOR SELECT USING (
    teacher_id = auth.uid()
  );

CREATE POLICY "Students can view co-teachers in enrolled subjects" ON public.subject_teachers
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

CREATE POLICY "Subject owner can add co-teachers" ON public.subject_teachers
  FOR INSERT WITH CHECK (
    subject_id IN (
      SELECT id FROM public.subjects WHERE teacher_id = auth.uid()
    )
  );

CREATE POLICY "Subject owner can remove co-teachers" ON public.subject_teachers
  FOR DELETE USING (
    subject_id IN (
      SELECT id FROM public.subjects WHERE teacher_id = auth.uid()
    )
  );

-- 5. Update get_teacher_subject_ids() to also return subjects from subject_teachers
CREATE OR REPLACE FUNCTION public.get_teacher_subject_ids(teacher_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.subjects WHERE subjects.teacher_id = teacher_id
  UNION
  SELECT subject_id FROM public.subject_teachers WHERE subject_teachers.teacher_id = teacher_id;
$$;

-- 6. Add trigger to automatically add the course creator to subject_teachers as 'owner'
CREATE OR REPLACE FUNCTION public.add_subject_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subject_teachers (subject_id, teacher_id, role, added_by)
  VALUES (NEW.id, NEW.teacher_id, 'owner', NEW.teacher_id)
  ON CONFLICT (subject_id, teacher_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_add_subject_owner ON public.subjects;
CREATE TRIGGER trg_add_subject_owner
  AFTER INSERT ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.add_subject_owner();

-- 7. Backfill existing subjects: add all current subject owners to subject_teachers
INSERT INTO public.subject_teachers (subject_id, teacher_id, role, added_by)
SELECT id, teacher_id, 'owner', teacher_id
FROM public.subjects
ON CONFLICT (subject_id, teacher_id) DO NOTHING;

-- 8. Grant permissions
GRANT SELECT, INSERT, DELETE ON public.subject_teachers TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.subject_teachers TO anon;

-- 9. Add to realtime publication
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_teachers; EXCEPTION WHEN OTHERS THEN NULL; END $$;
