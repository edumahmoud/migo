-- Migration v18: Add 'chat' notification type
-- This allows chat message notifications to be persisted in the DB
-- Previously, the /api/notify chat_message action would fail with a constraint violation

ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'file_request', 'system', 'attendance', 'link_request', 'lecture', 'chat'));
