-- Migration v12: Add 'file_request' notification type
-- This allows file request notifications to be stored in the database.

ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'file_request', 'system', 'attendance', 'link_request'));
