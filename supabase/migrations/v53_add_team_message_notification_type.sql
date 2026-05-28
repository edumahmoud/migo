-- v53: Add 'team_message' notification type
-- This type is used when a teacher sends a note/message to a team group
-- Without this, team_message notifications fail at the DB level due to CHECK constraint violation

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'grade', 'enrollment', 'file', 'file_request',
    'system', 'attendance', 'link_request', 'lecture', 'chat',
    'report', 'poll', 'team_message'
  ));
