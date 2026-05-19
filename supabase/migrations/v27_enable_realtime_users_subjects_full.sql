-- Migration v27: Enable Realtime for users table + set REPLICA IDENTITY FULL for subjects & subject_students
-- This enables:
-- 1. Admin dashboard to receive instant user change notifications
-- 2. DELETE events on subjects/subject_students to include full row data for surgical Realtime updates

-- Add users table to the realtime publication (for admin dashboard instant updates)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  RAISE NOTICE 'users table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'users may already be in supabase_realtime: %', SQLERRM;
END $$;

-- Set REPLICA IDENTITY FULL for subjects table
-- This ensures DELETE events include the full row data (not just primary key),
-- which is needed for surgical Realtime updates in student dashboards.
ALTER TABLE public.subjects REPLICA IDENTITY FULL;

-- Set REPLICA IDENTITY FULL for subject_students table
-- This ensures DELETE events include subject_id in the old record,
-- allowing students to instantly see when they are removed from a course.
ALTER TABLE public.subject_students REPLICA IDENTITY FULL;

-- Also add teacher_student_links to realtime if not already (used by teacher/student dashboards)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.teacher_student_links;
  RAISE NOTICE 'teacher_student_links table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'teacher_student_links may already be in supabase_realtime: %', SQLERRM;
END $$;

-- Add assignments and submissions to realtime for instant CRUD updates
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;
  RAISE NOTICE 'assignments table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'assignments may already be in supabase_realtime: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
  RAISE NOTICE 'submissions table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'submissions may already be in supabase_realtime: %', SQLERRM;
END $$;

-- Add attendance_sessions and attendance_records to realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
  RAISE NOTICE 'attendance_sessions table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'attendance_sessions may already be in supabase_realtime: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
  RAISE NOTICE 'attendance_records table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'attendance_records may already be in supabase_realtime: %', SQLERRM;
END $$;

-- Set REPLICA IDENTITY FULL for tables that need old row data in DELETE events
ALTER TABLE public.teacher_student_links REPLICA IDENTITY FULL;
ALTER TABLE public.assignments REPLICA IDENTITY FULL;
ALTER TABLE public.submissions REPLICA IDENTITY FULL;
ALTER TABLE public.attendance_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.attendance_records REPLICA IDENTITY FULL;
