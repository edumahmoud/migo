-- V10: Fix enrollment access control
-- Update RLS helper functions to only return subjects where the student is APPROVED
-- Previously, get_student_subject_ids() returned ALL enrollments (pending/rejected/approved)
-- allowing unapproved students to access course content through RLS policies.

-- Fix 1: get_student_subject_ids() - Only return subjects where enrollment is approved
CREATE OR REPLACE FUNCTION public.get_student_subject_ids(student_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT subject_id FROM public.subject_students
  WHERE subject_students.student_id = student_id
  AND subject_students.status = 'approved';
$$;

-- Fix 2: is_subject_student() - Only return true if enrollment is approved
CREATE OR REPLACE FUNCTION public.is_subject_student(subject_id UUID, student_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subject_students
    WHERE subject_students.subject_id = subject_id
    AND subject_students.student_id = student_id
    AND subject_students.status = 'approved'
  );
$$;

-- Fix 3: is_lecture_student() - Only return true if enrollment is approved
CREATE OR REPLACE FUNCTION public.is_lecture_student(lecture_id UUID, student_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lectures l
    JOIN public.subject_students ss ON l.subject_id = ss.subject_id
    WHERE l.id = lecture_id
    AND ss.student_id = student_id
    AND ss.status = 'approved'
  );
$$;

-- Re-grant permissions (idempotent)
GRANT EXECUTE ON FUNCTION public.get_student_subject_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_subject_student(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_lecture_student(UUID, UUID) TO authenticated, anon;
