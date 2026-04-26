-- =====================================================
-- إصلاح نهائي لمشكلة التكرار اللانهائي في سياسات RLS
-- ROOT CAUSE: RLS policies on `users` table query `users` itself → infinite recursion (42P17)
-- 
-- FIX: 
-- 1. Create SECURITY DEFINER function `is_admin()` that bypasses RLS
-- 2. Drop ALL self-referencing policies on `users` table
-- 3. Replace ALL admin policies on other tables with `is_admin()` calls
--
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- STEP 1: Create SECURITY DEFINER helper function
-- This function runs with elevated privileges (bypasses RLS)
-- so it can check the user's role without triggering recursion
-- ═══════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.get_user_role(UUID);

-- Check if current user is admin or superadmin (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
  );
$$;

-- Get the role of a specific user (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_role(check_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = check_user_id;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════
-- STEP 2: Fix USERS table policies (THE ROOT CAUSE)
-- Drop the self-referencing "Admins can read all users" policy
-- "Authenticated users can read profiles" already covers admin access
-- ═══════════════════════════════════════════════════════

-- Drop the BROKEN self-referencing admin policy
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;

-- Ensure these safe policies exist:
-- (these don't cause recursion because they don't query the users table)

-- Policy 1: Users can read their own profile
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

-- Policy 2: Users can insert their own profile (for signup)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Policy 3: Users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Policy 4: Teachers can read linked students
DROP POLICY IF EXISTS "Teachers can read linked students" ON public.users;
CREATE POLICY "Teachers can read linked students" ON public.users
  FOR SELECT USING (
    id IN (SELECT student_id FROM public.teacher_student_links WHERE teacher_id = auth.uid() AND status = 'approved')
  );

-- Policy 5: Anyone authenticated can find teachers
DROP POLICY IF EXISTS "Anyone authenticated can find teachers" ON public.users;
CREATE POLICY "Anyone authenticated can find teachers" ON public.users
  FOR SELECT USING (role = 'teacher' AND teacher_code IS NOT NULL);

-- Policy 6: All authenticated users can read profiles (COVERS ADMIN ACCESS TOO)
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.users;
CREATE POLICY "Authenticated users can read profiles" ON public.users
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════
-- STEP 3: Fix admin policies on ALL other tables
-- Replace EXISTS subqueries with is_admin() function calls
-- ═══════════════════════════════════════════════════════

-- ===== SUBJECTS =====
DROP POLICY IF EXISTS "Admins can read all subjects" ON public.subjects;
DROP POLICY IF EXISTS "Admins can manage all subjects" ON public.subjects;
CREATE POLICY "Admins can read all subjects" ON public.subjects
  FOR SELECT USING (public.is_admin());

-- ===== SCORES =====
DROP POLICY IF EXISTS "Admins can read all scores" ON public.scores;
CREATE POLICY "Admins can read all scores" ON public.scores
  FOR SELECT USING (public.is_admin());

-- ===== QUIZZES =====
DROP POLICY IF EXISTS "Admins can read all quizzes" ON public.quizzes;
CREATE POLICY "Admins can read all quizzes" ON public.quizzes
  FOR SELECT USING (public.is_admin());

-- ===== TEACHER_STUDENT_LINKS =====
DROP POLICY IF EXISTS "Admins can read all links" ON public.teacher_student_links;
CREATE POLICY "Admins can read all links" ON public.teacher_student_links
  FOR SELECT USING (public.is_admin());

-- ===== SUBJECT_STUDENTS =====
DROP POLICY IF EXISTS "Admins can read all enrollments" ON public.subject_students;
CREATE POLICY "Admins can read all enrollments" ON public.subject_students
  FOR SELECT USING (public.is_admin());

-- ===== SUBJECT_TEACHERS =====
DROP POLICY IF EXISTS "Admins can read all subject_teachers" ON public.subject_teachers;
CREATE POLICY "Admins can read all subject_teachers" ON public.subject_teachers
  FOR SELECT USING (public.is_admin());

-- ===== LECTURES =====
DROP POLICY IF EXISTS "Admins can read all lectures" ON public.lectures;
CREATE POLICY "Admins can read all lectures" ON public.lectures
  FOR SELECT USING (public.is_admin());

-- ===== ASSIGNMENTS =====
DROP POLICY IF EXISTS "Admins can read all assignments" ON public.assignments;
CREATE POLICY "Admins can read all assignments" ON public.assignments
  FOR SELECT USING (public.is_admin());

-- ===== SUBMISSIONS =====
DROP POLICY IF EXISTS "Admins can read all submissions" ON public.submissions;
CREATE POLICY "Admins can read all submissions" ON public.submissions
  FOR SELECT USING (public.is_admin());

-- ===== ATTENDANCE_SESSIONS =====
DROP POLICY IF EXISTS "Admins can read all attendance_sessions" ON public.attendance_sessions;
CREATE POLICY "Admins can read all attendance_sessions" ON public.attendance_sessions
  FOR SELECT USING (public.is_admin());

-- ===== ATTENDANCE_RECORDS =====
DROP POLICY IF EXISTS "Admins can read all attendance_records" ON public.attendance_records;
CREATE POLICY "Admins can read all attendance_records" ON public.attendance_records
  FOR SELECT USING (public.is_admin());

-- ===== ANNOUNCEMENTS =====
DROP POLICY IF EXISTS "Admins can manage all announcements" ON public.announcements;
CREATE POLICY "Admins can manage all announcements" ON public.announcements
  FOR ALL USING (public.is_admin());

-- Also ensure non-admins can read active announcements
DROP POLICY IF EXISTS "Anyone can read active announcements" ON public.announcements;
CREATE POLICY "Anyone can read active announcements" ON public.announcements
  FOR SELECT USING (is_active = true);

-- ===== BANNED_USERS =====
DROP POLICY IF EXISTS "Admins can manage banned users" ON public.banned_users;
CREATE POLICY "Admins can manage banned users" ON public.banned_users
  FOR ALL USING (public.is_admin());

-- ===== INSTITUTION_SETTINGS =====
DROP POLICY IF EXISTS "Anyone can read institution_settings" ON public.institution_settings;
CREATE POLICY "Anyone can read institution_settings" ON public.institution_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage institution_settings" ON public.institution_settings;
CREATE POLICY "Admins can manage institution_settings" ON public.institution_settings
  FOR ALL USING (public.is_admin());

-- ===== SUMMARIES =====
DROP POLICY IF EXISTS "Admins can read all summaries" ON public.summaries;
CREATE POLICY "Admins can read all summaries" ON public.summaries
  FOR SELECT USING (public.is_admin());

-- ===== LECTURE_NOTES =====
DROP POLICY IF EXISTS "Admins can read all lecture_notes" ON public.lecture_notes;
CREATE POLICY "Admins can read all lecture_notes" ON public.lecture_notes
  FOR SELECT USING (public.is_admin());

-- ===== USER_FILES =====
DROP POLICY IF EXISTS "Admins can read all user_files" ON public.user_files;
CREATE POLICY "Admins can read all user_files" ON public.user_files
  FOR SELECT USING (public.is_admin());

-- ===== SUBJECT_FILES =====
DROP POLICY IF EXISTS "Admins can read all subject_files" ON public.subject_files;
CREATE POLICY "Admins can read all subject_files" ON public.subject_files
  FOR SELECT USING (public.is_admin());

-- ===== FILE_SHARES =====
DROP POLICY IF EXISTS "Admins can read all file_shares" ON public.file_shares;
CREATE POLICY "Admins can read all file_shares" ON public.file_shares
  FOR SELECT USING (public.is_admin());

-- ===== FILE_REQUESTS =====
DROP POLICY IF EXISTS "Admins can read all file_requests" ON public.file_requests;
CREATE POLICY "Admins can read all file_requests" ON public.file_requests
  FOR SELECT USING (public.is_admin());

-- ===== NOTIFICATIONS =====
DROP POLICY IF EXISTS "Admins can read all notifications" ON public.notifications;
CREATE POLICY "Admins can read all notifications" ON public.notifications
  FOR SELECT USING (public.is_admin());

-- ===== USER_SESSIONS =====
DROP POLICY IF EXISTS "Admins can read all user_sessions" ON public.user_sessions;
CREATE POLICY "Admins can read all user_sessions" ON public.user_sessions
  FOR SELECT USING (public.is_admin());

-- ===== CONVERSATIONS =====
DROP POLICY IF EXISTS "Admins can read all conversations" ON public.conversations;
CREATE POLICY "Admins can read all conversations" ON public.conversations
  FOR SELECT USING (public.is_admin());

-- ===== CONVERSATION_PARTICIPANTS =====
DROP POLICY IF EXISTS "Admins can read all conversation_participants" ON public.conversation_participants;
CREATE POLICY "Admins can read all conversation_participants" ON public.conversation_participants
  FOR SELECT USING (public.is_admin());

-- ===== MESSAGES =====
DROP POLICY IF EXISTS "Admins can read all messages" ON public.messages;
CREATE POLICY "Admins can read all messages" ON public.messages
  FOR SELECT USING (public.is_admin());

-- ===== NOTE_VIEWS =====
DROP POLICY IF EXISTS "Admins can read all note_views" ON public.note_views;
CREATE POLICY "Admins can read all note_views" ON public.note_views
  FOR SELECT USING (public.is_admin());

-- ═══════════════════════════════════════════════════════
-- STEP 4: Storage policies for institution logos
-- ═══════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Anyone can read institution logos" ON storage.objects;
CREATE POLICY "Anyone can read institution logos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND
    (storage.foldername(name))[1] = 'institution'
  );

-- ═══════════════════════════════════════════════════════
-- VERIFICATION: Test the is_admin() function
-- ═══════════════════════════════════════════════════════

-- This should return true if you're logged in as admin/superadmin
-- SELECT public.is_admin();
-- This should return your role
-- SELECT public.get_user_role(auth.uid());
