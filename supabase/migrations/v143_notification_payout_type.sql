-- v143: allow the 'payout' notification type (teacher settlement/payout notifications).
-- Before this, notifyUser(..., 'payout', ...) failed the CHECK constraint, so teachers
-- received no in-app or push notification when a settlement completed.
-- Rollback at the bottom (commented).

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'grade', 'enrollment', 'file', 'file_request',
    'system', 'attendance', 'link_request', 'lecture', 'chat',
    'report', 'poll', 'team_message', 'quiz', 'payout'
  ));

-- ROLLBACK (only valid while no 'payout' rows exist, or delete them first):
-- DELETE FROM public.notifications WHERE type = 'payout';
-- ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
--   CHECK (type IN ('assignment','grade','enrollment','file','file_request','system','attendance','link_request','lecture','chat','report','poll','team_message','quiz'));
