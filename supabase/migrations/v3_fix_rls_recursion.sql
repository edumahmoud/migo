-- =====================================================
-- Fix: Infinite Recursion in RLS Policies
-- =====================================================
-- Problem: subjects ↔ subject_students RLS policies reference each other,
-- creating an infinite recursion (error 42P17).
--
-- Solution: Replace cross-table subqueries in RLS policies with
-- SECURITY DEFINER functions that bypass RLS when checking relationships.
-- These functions run with the privileges of their creator (superuser),
-- so they don't trigger RLS on the tables they query.
--
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- STEP 1: Create SECURITY DEFINER helper functions
-- ═══════════════════════════════════════════════════════

-- IMPORTANT: Drop existing functions first because PostgreSQL
-- does not allow changing parameter names with CREATE OR REPLACE
-- (error 42P13: cannot change name of input parameter)
DROP FUNCTION IF EXISTS public.is_subject_teacher(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_subject_student(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_teacher_subject_ids(UUID);
DROP FUNCTION IF EXISTS public.get_student_subject_ids(UUID);
DROP FUNCTION IF EXISTS public.is_lecture_teacher(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_lecture_student(UUID, UUID);

-- Check if a user is the teacher of a subject (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_subject_teacher(subject_id UUID, teacher_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subjects
    WHERE id = subject_id AND subjects.teacher_id = teacher_id
  );
$$;

-- Check if a student is enrolled in a subject (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_subject_student(subject_id UUID, student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subject_students
    WHERE subject_students.subject_id = subject_id
    AND subject_students.student_id = student_id
  );
$$;

-- Get all subject IDs for a teacher (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_teacher_subject_ids(teacher_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.subjects WHERE subjects.teacher_id = teacher_id;
$$;

-- Get all subject IDs a student is enrolled in (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_student_subject_ids(student_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT subject_id FROM public.subject_students WHERE subject_students.student_id = student_id;
$$;

-- Check if a lecture belongs to a teacher's subject (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_lecture_teacher(lecture_id UUID, teacher_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lectures l
    JOIN public.subjects s ON l.subject_id = s.id
    WHERE l.id = lecture_id AND s.teacher_id = teacher_id
  );
$$;

-- Check if a lecture belongs to a student's enrolled subject (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_lecture_student(lecture_id UUID, student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lectures l
    JOIN public.subject_students ss ON l.subject_id = ss.subject_id
    WHERE l.id = lecture_id AND ss.student_id = student_id
  );
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.is_subject_teacher(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_subject_student(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_subject_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_student_subject_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_lecture_teacher(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_lecture_student(UUID, UUID) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════
-- STEP 2: Drop and recreate RLS policies (no circular references)
-- ═══════════════════════════════════════════════════════

-- ===== SUBJECTS =====
DROP POLICY IF EXISTS "Teachers can view own subjects" ON public.subjects;
DROP POLICY IF EXISTS "Students can view enrolled subjects" ON public.subjects;
DROP POLICY IF EXISTS "Teachers can create subjects" ON public.subjects;
DROP POLICY IF EXISTS "Teachers can update own subjects" ON public.subjects;
DROP POLICY IF EXISTS "Teachers can delete own subjects" ON public.subjects;

CREATE POLICY "Teachers can view own subjects" ON public.subjects
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "Students can view enrolled subjects" ON public.subjects
  FOR SELECT USING (
    id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can create subjects" ON public.subjects
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Teachers can update own subjects" ON public.subjects
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY "Teachers can delete own subjects" ON public.subjects
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== SUBJECT_STUDENTS =====
DROP POLICY IF EXISTS "Teachers can view enrollments in their subjects" ON public.subject_students;
DROP POLICY IF EXISTS "Students can view own enrollments" ON public.subject_students;
DROP POLICY IF EXISTS "Teachers can enroll students" ON public.subject_students;
DROP POLICY IF EXISTS "Teachers can remove students" ON public.subject_students;

CREATE POLICY "Teachers can view enrollments in their subjects" ON public.subject_students
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Students can view own enrollments" ON public.subject_students
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Teachers can enroll students" ON public.subject_students
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can remove students" ON public.subject_students
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- ===== LECTURES =====
DROP POLICY IF EXISTS "Teachers can view lectures in own subjects" ON public.lectures;
DROP POLICY IF EXISTS "Students can view lectures in enrolled subjects" ON public.lectures;
DROP POLICY IF EXISTS "Teachers can create lectures" ON public.lectures;
DROP POLICY IF EXISTS "Teachers can update lectures" ON public.lectures;
DROP POLICY IF EXISTS "Teachers can delete lectures" ON public.lectures;

CREATE POLICY "Teachers can view lectures in own subjects" ON public.lectures
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Students can view lectures in enrolled subjects" ON public.lectures
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can create lectures" ON public.lectures
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can update lectures" ON public.lectures
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can delete lectures" ON public.lectures
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- ===== LECTURE_NOTES =====
DROP POLICY IF EXISTS "Teachers can view all notes in their subjects" ON public.lecture_notes;
DROP POLICY IF EXISTS "Students can view public notes in enrolled subjects" ON public.lecture_notes;
DROP POLICY IF EXISTS "Users can create notes" ON public.lecture_notes;
DROP POLICY IF EXISTS "Users can update own notes" ON public.lecture_notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON public.lecture_notes;

CREATE POLICY "Teachers can view all notes in their subjects" ON public.lecture_notes
  FOR SELECT USING (
    public.is_lecture_teacher(lecture_id, auth.uid())
  );

CREATE POLICY "Students can view public notes in enrolled subjects" ON public.lecture_notes
  FOR SELECT USING (
    (visibility = 'public' AND public.is_lecture_student(lecture_id, auth.uid()))
    OR user_id = auth.uid()
  );

CREATE POLICY "Users can create notes" ON public.lecture_notes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own notes" ON public.lecture_notes
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own notes" ON public.lecture_notes
  FOR DELETE USING (user_id = auth.uid());

-- ===== ASSIGNMENTS =====
DROP POLICY IF EXISTS "Teachers can view assignments in own subjects" ON public.assignments;
DROP POLICY IF EXISTS "Students can view assignments in enrolled subjects" ON public.assignments;
DROP POLICY IF EXISTS "Teachers can create assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teachers can update own assignments" ON public.assignments;
DROP POLICY IF EXISTS "Teachers can delete own assignments" ON public.assignments;

CREATE POLICY "Teachers can view assignments in own subjects" ON public.assignments
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Students can view assignments in enrolled subjects" ON public.assignments
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can create assignments" ON public.assignments
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Teachers can update own assignments" ON public.assignments
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY "Teachers can delete own assignments" ON public.assignments
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== SUBJECT_FILES =====
DROP POLICY IF EXISTS "Teachers can view files in own subjects" ON public.subject_files;
DROP POLICY IF EXISTS "Students can view files in enrolled subjects" ON public.subject_files;
DROP POLICY IF EXISTS "Teachers can upload files to own subjects" ON public.subject_files;
DROP POLICY IF EXISTS "Teachers can update files in own subjects" ON public.subject_files;
DROP POLICY IF EXISTS "Teachers can delete files in own subjects" ON public.subject_files;

CREATE POLICY "Teachers can view files in own subjects" ON public.subject_files
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Students can view files in enrolled subjects" ON public.subject_files
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can upload files to own subjects" ON public.subject_files
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can update files in own subjects" ON public.subject_files
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can delete files in own subjects" ON public.subject_files
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- ===== SUBMISSIONS =====
DROP POLICY IF EXISTS "Teachers can view submissions for their assignments" ON public.submissions;
DROP POLICY IF EXISTS "Students can view own submissions" ON public.submissions;
DROP POLICY IF EXISTS "Students can create submissions" ON public.submissions;
DROP POLICY IF EXISTS "Students can update own ungraded submissions" ON public.submissions;
DROP POLICY IF EXISTS "Teachers can grade submissions for their assignments" ON public.submissions;

CREATE POLICY "Teachers can view submissions for their assignments" ON public.submissions
  FOR SELECT USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      WHERE a.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );

CREATE POLICY "Students can view own submissions" ON public.submissions
  FOR SELECT USING (student_id = auth.uid());

CREATE POLICY "Students can create submissions" ON public.submissions
  FOR INSERT WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can update own ungraded submissions" ON public.submissions
  FOR UPDATE USING (student_id = auth.uid() AND status = 'submitted');

CREATE POLICY "Teachers can grade submissions for their assignments" ON public.submissions
  FOR UPDATE USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      WHERE a.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );

-- ===== ATTENDANCE_SESSIONS =====
DROP POLICY IF EXISTS "Teachers can view own attendance sessions" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Students can view attendance sessions in enrolled subjects" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teachers can create attendance sessions" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teachers can update own attendance sessions" ON public.attendance_sessions;
DROP POLICY IF EXISTS "Teachers can delete own attendance sessions" ON public.attendance_sessions;

CREATE POLICY "Teachers can view own attendance sessions" ON public.attendance_sessions
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "Students can view attendance sessions in enrolled subjects" ON public.attendance_sessions
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

CREATE POLICY "Teachers can create attendance sessions" ON public.attendance_sessions
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
  );

CREATE POLICY "Teachers can update own attendance sessions" ON public.attendance_sessions
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY "Teachers can delete own attendance sessions" ON public.attendance_sessions
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== ATTENDANCE_RECORDS =====
DROP POLICY IF EXISTS "Students can check in to attendance" ON public.attendance_records;

CREATE POLICY "Students can check in to attendance" ON public.attendance_records
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
  );
