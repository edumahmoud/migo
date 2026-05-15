-- Migration v11: Enable realtime for teacher_student_links & add 'link_request' notification type
-- This fixes the teacher not receiving student link requests in real-time.

-- 1. Add teacher_student_links to the realtime publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.teacher_student_links;
  RAISE NOTICE 'teacher_student_links table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'teacher_student_links may already be in supabase_realtime: %', SQLERRM;
END $$;

-- 2. Add 'link_request' to notifications type check constraint
ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'system', 'attendance', 'link_request'));
