-- =====================================================
-- v38: Report system enhancements
-- 1. Add target_content column to reports (stores the reported comment/message text)
-- 2. Add reporter_count column to reports (number of people who reported the target)
-- 3. Add 'block' and 'warn' actions to report_responses
-- 4. Add report_messages table (messages from reviewer to reporter / reported user)
-- =====================================================

-- 1. Add target_content column — stores the actual content of the reported comment/message
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS target_content TEXT;
COMMENT ON COLUMN public.reports.target_content IS 'The content of the reported comment or message';

-- 2. Add reporter_count column — how many distinct users reported this target
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reporter_count INTEGER DEFAULT 1;
COMMENT ON COLUMN public.reports.reporter_count IS 'Number of distinct users who reported this target';

-- 3. Extend report_responses action to include 'block' and 'warn'
ALTER TABLE public.report_responses DROP CONSTRAINT IF EXISTS report_responses_action_check;
ALTER TABLE public.report_responses ADD CONSTRAINT report_responses_action_check
  CHECK (action IN ('reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'message_reporter', 'message_reported'));


-- 4. Create report_messages table
-- Stores messages sent from the reviewer to the reporter or the reported user
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

-- RLS on report_messages
ALTER TABLE public.report_messages ENABLE ROW LEVEL SECURITY;

-- Users involved in the report can read messages
DROP POLICY IF EXISTS "Users can view report messages" ON public.report_messages;
CREATE POLICY "Users can view report messages" ON public.report_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.reporter_id = auth.uid()
        OR r.assigned_to = auth.uid()
        OR auth.uid() = recipient_id
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );

-- Assigned user or admin can send messages
DROP POLICY IF EXISTS "Assigned users and admins can send report messages" ON public.report_messages;
CREATE POLICY "Assigned users and admins can send report messages" ON public.report_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.assigned_to = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );


-- 5. Enable Realtime on report_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_messages;
ALTER TABLE public.report_messages REPLICA IDENTITY FULL;


-- 6. Function: update reporter_count when a new report is created
-- This counts how many distinct reporters have reported the same target
CREATE OR REPLACE FUNCTION public.update_reporter_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Count distinct reporters for the same target
  SELECT COUNT(DISTINCT reporter_id) INTO v_count
  FROM public.reports
  WHERE target_type = NEW.target_type
    AND target_id = NEW.target_id
    AND target_id IS NOT NULL;

  -- Update all reports for this target with the new count
  UPDATE public.reports
  SET reporter_count = GREATEST(v_count, 1)
  WHERE target_type = NEW.target_type
    AND target_id = NEW.target_id
    AND target_id IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_reporter_count ON public.reports;
CREATE TRIGGER trg_update_reporter_count
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_reporter_count();


-- 7. Function: create notification when a message is sent to reporter or reported user
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
      WHEN 'reported' THEN 'إشعار بخصوص بلاغ مقد ضددك'
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
