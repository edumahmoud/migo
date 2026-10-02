-- =====================================================
-- v92: Immediate student-teacher linking — no approval
-- =====================================================
-- GOAL: eliminate the teacher approval requirement for
-- student-teacher linking. All links are immediate (status='approved')
-- regardless of who initiated (student or teacher).
--
-- Changes:
--   1. Convert all existing 'pending' links to 'approved'
--   2. Mark all unread 'link_request' notifications as read
--      (the approval modal won't trigger anymore)
--   3. Clean up 'rejected' links (they're stale)
-- =====================================================

-- 1. Convert all existing pending links to approved
UPDATE public.teacher_student_links
SET status = 'approved'
WHERE status = 'pending';

-- 2. Delete rejected links (stale — no longer relevant)
DELETE FROM public.teacher_student_links
WHERE status = 'rejected';

-- 3. Mark all unread link_request notifications as read
--    so the deprecated approval modal doesn't trigger
UPDATE public.notifications
SET read = true
WHERE type = 'link_request' AND read = false;

-- 4. Add a comment explaining the new policy
COMMENT ON COLUMN public.teacher_student_links.status IS
  'v92: all new links are immediate (status=approved). The pending/rejected statuses are legacy — existing rows were converted to approved. The approval flow (link-teacher-approve, link-student-approve) is deprecated but kept for backward compat.';

-- Done.
-- Verify:
--   SELECT status, COUNT(*) FROM public.teacher_student_links GROUP BY status;
--   -- Should show only 'approved'
--   SELECT COUNT(*) FROM public.notifications WHERE type = 'link_request' AND read = false;
--   -- Should be 0
