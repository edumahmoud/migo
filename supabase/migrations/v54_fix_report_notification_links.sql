-- v54: Fix report notification deep link format
-- The report notification triggers were using 'report:ID' format instead of '/reports/ID'
-- This fixes the deep link to use the standard '/reports/ID' format that the client expects

-- ─── Fix notify_report_message() ───
CREATE OR REPLACE FUNCTION public.notify_report_message()
RETURNS TRIGGER AS $$
DECLARE
  v_report RECORD;
  v_reporter_id UUID;
  v_recipient_id UUID;
  v_report_number TEXT;
BEGIN
  -- Get report details
  SELECT id, reporter_id, assigned_to, report_number INTO v_report
  FROM public.reports WHERE id = NEW.report_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  v_report_number := v_report.report_number;

  -- Determine recipient (opposite of sender)
  IF NEW.sender_id = v_report.reporter_id THEN
    v_recipient_id := COALESCE(v_report.assigned_to, v_report.reporter_id);
  ELSE
    v_recipient_id := v_report.reporter_id;
  END IF;

  -- Don't notify yourself
  IF NEW.sender_id = v_recipient_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (
    v_recipient_id,
    'report',
    CASE
      WHEN NEW.message_type = 'auto' THEN 'تحديث تلقائي على البلاغ'
      ELSE 'رسالة جديدة على البلاغ'
    END,
    CASE
      WHEN NEW.message_type = 'auto' THEN 'تم تحديث البلاغ رقم ' || v_report_number || ' تلقائياً'
      ELSE 'لديك رسالة جديدة على البلاغ رقم ' || v_report_number
    END,
    '/reports/' || NEW.report_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Fix notify_handler_new_report() ───
CREATE OR REPLACE FUNCTION public.notify_handler_new_report()
RETURNS TRIGGER AS $$
DECLARE
  v_handler_id UUID;
BEGIN
  -- Only notify if there's an assigned handler
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  -- Don't notify if the handler is the reporter
  IF NEW.assigned_to = NEW.reporter_id THEN
    RETURN NEW;
  END IF;

  -- Notify the assigned handler about the new report
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (
    NEW.assigned_to,
    'report',
    'بلاغ جديد تم تعيينه لك',
    'تم تعيين البلاغ رقم ' || NEW.report_number || ' إليك للمراجعة',
    '/reports/' || NEW.id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
