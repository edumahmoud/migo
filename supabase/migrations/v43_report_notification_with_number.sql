-- =====================================================
-- v43: Update notify_report_message trigger to include
--      report_number in notifications for المشكو ضده
--      and handle warning message_type
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_report_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sender_name TEXT;
  v_report_reason TEXT;
  v_report_number TEXT;
BEGIN
  SELECT name INTO v_sender_name FROM public.users WHERE id = NEW.sender_id;
  SELECT reason, report_number INTO v_report_reason, v_report_number FROM public.reports WHERE id = NEW.report_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, read)
  VALUES (
    NEW.recipient_id,
    'report',
    CASE
      WHEN NEW.message_type = 'warning' THEN 'تحذير بخصوص شكوى مقدم ضدها'
      WHEN NEW.recipient_type = 'reporter' THEN 'رسالة بخصوص شكواك'
      WHEN NEW.recipient_type = 'reported' THEN 'إشعار بخصوص شكوى مقدم ضدك'
    END,
    CASE
      WHEN NEW.message_type = 'warning' THEN
        '[' || COALESCE(v_report_number, NEW.report_id::TEXT) || '] ' || LEFT(NEW.content, 100)
      WHEN NEW.recipient_type = 'reported' THEN
        COALESCE(v_sender_name, 'مراجع') || ': ' || '[' || COALESCE(v_report_number, NEW.report_id::TEXT) || '] ' || LEFT(NEW.content, 100)
      ELSE
        COALESCE(v_sender_name, 'مراجع') || ': ' || LEFT(NEW.content, 100)
    END,
    '/reports/' || NEW.report_id,
    false
  );

  RETURN NEW;
END;
$$;
