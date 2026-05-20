-- =====================================================
-- v40: Ensure report_messages table + fix RLS policies
-- This migration is idempotent — safe to run multiple times.
-- 1. Create report_messages table IF NOT EXISTS
-- 2. Ensure RLS SELECT policy includes recipient_id
-- 3. Ensure RLS INSERT policy allows service role inserts
-- 4. Add 'return' action to report_responses CHECK constraint
-- =====================================================

-- 1. Create report_messages table (idempotent)
CREATE TABLE IF NOT EXISTS public.report_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('reporter', 'reported')),
  recipient_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_messages_report_id ON public.report_messages(report_id);
CREATE INDEX IF NOT EXISTS idx_report_messages_recipient_id ON public.report_messages(recipient_id);

-- Enable RLS
ALTER TABLE public.report_messages ENABLE ROW LEVEL SECURITY;

-- 2. Update SELECT policy — users can see messages where they are the recipient,
--    the reporter, the assigned user, or an admin
DROP POLICY IF EXISTS "Users can view report messages" ON public.report_messages;
CREATE POLICY "Users can view report messages" ON public.report_messages
  FOR SELECT USING (
    -- The recipient can always see their own messages
    auth.uid() = recipient_id
    OR EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.reporter_id = auth.uid()
        OR r.assigned_to = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );

-- 3. Update INSERT policy — assigned user or admin can send messages
--    The service role (used by API) bypasses RLS, so this mainly affects direct client inserts
DROP POLICY IF EXISTS "Assigned users and admins can send report messages" ON public.report_messages;
CREATE POLICY "Assigned users and admins can send report messages" ON public.report_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.assigned_to = auth.uid()
        OR r.reporter_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );

-- 4. Ensure 'return' action exists in report_responses CHECK constraint
ALTER TABLE public.report_responses DROP CONSTRAINT IF EXISTS report_responses_action_check;
ALTER TABLE public.report_responses ADD CONSTRAINT report_responses_action_check
  CHECK (action IN ('reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'return', 'message_reporter', 'message_reported'));

-- 5. Enable Realtime on report_messages (idempotent — check before adding)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'report_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.report_messages;
  END IF;
END $$;
ALTER TABLE public.report_messages REPLICA IDENTITY FULL;

-- 6. Ensure the notify trigger exists (creates notification when message is sent)
CREATE OR REPLACE FUNCTION public.notify_report_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sender_name TEXT;
  v_report_reason TEXT;
BEGIN
  SELECT name INTO v_sender_name FROM public.users WHERE id = NEW.sender_id;
  SELECT reason INTO v_report_reason FROM public.reports WHERE id = NEW.report_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, read)
  VALUES (
    NEW.recipient_id,
    'report',
    CASE NEW.recipient_type
      WHEN 'reporter' THEN 'رسالة بخصوص إبلاغك'
      WHEN 'reported' THEN 'إشعار بخصوص بلاغ مقد ضدك'
    END,
    COALESCE(v_sender_name, 'مراجع') || ': ' || LEFT(NEW.content, 100),
    '/reports/' || NEW.report_id,
    false
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_report_message ON public.report_messages;
CREATE TRIGGER trg_notify_report_message
  AFTER INSERT ON public.report_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_report_message();

-- 7. Update reports SELECT RLS to include the target user (idempotent with v39)
DROP POLICY IF EXISTS "Users can view relevant reports" ON public.reports;
CREATE POLICY "Users can view relevant reports" ON public.reports
  FOR SELECT USING (
    auth.uid() = reporter_id
    OR auth.uid() = assigned_to
    OR (target_type = 'user' AND target_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  );

-- 8. Update report_responses SELECT RLS to include the target user
DROP POLICY IF EXISTS "Users can view report responses" ON public.report_responses;
CREATE POLICY "Users can view report responses" ON public.report_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.reporter_id = auth.uid()
        OR r.assigned_to = auth.uid()
        OR (r.target_type = 'user' AND r.target_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );
