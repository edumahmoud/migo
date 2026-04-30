-- Migration v14: Add 'lecture' notification type
-- This allows lecture creation notifications to use a dedicated type instead of 'system'

ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'file_request', 'system', 'attendance', 'link_request', 'lecture'));
