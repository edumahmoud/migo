-- =====================================================
-- v44: Add message_type to report_messages + auto-notify المشكو ضده on creation
-- =====================================================

-- 1. Add message_type column to report_messages
ALTER TABLE public.report_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'info'
  CHECK (message_type IN ('info', 'warning'));

-- 2. Create index for faster filtering by message_type
CREATE INDEX IF NOT EXISTS idx_report_messages_message_type
  ON public.report_messages (message_type);

-- 3. Create function to auto-send notification message to المشكو ضده when a report is created
CREATE OR REPLACE FUNCTION public.auto_notify_reported_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reported_user_id UUID;
  v_subject_name TEXT;
  v_report_num TEXT;
  v_reason_label TEXT;
  v_target_type_label TEXT;
  v_content_preview TEXT;
  v_message_body TEXT;
BEGIN
  -- Only act on new reports
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  -- Resolve the reported user based on target_type
  IF NEW.target_type = 'user' AND NEW.target_id IS NOT NULL THEN
    v_reported_user_id := NEW.target_id;
  ELSIF NEW.target_type = 'comment' AND NEW.target_id IS NOT NULL THEN
    SELECT vc.user_id INTO v_reported_user_id
    FROM public.video_comments vc
    WHERE vc.id = NEW.target_id;

    -- Get subject name for comment-type reports
    IF v_reported_user_id IS NOT NULL THEN
      SELECT s.name INTO v_subject_name
      FROM public.video_comments vc
      JOIN public.subject_videos sv ON sv.id = vc.video_id
      JOIN public.subjects s ON s.id = sv.subject_id
      WHERE vc.id = NEW.target_id;
    END IF;

    -- Get content preview
    SELECT LEFT(vc.content, 80) INTO v_content_preview
    FROM public.video_comments vc
    WHERE vc.id = NEW.target_id;

  ELSIF NEW.target_type = 'message' AND NEW.target_id IS NOT NULL THEN
    SELECT cm.sender_id INTO v_reported_user_id
    FROM public.chat_messages cm
    WHERE cm.id = NEW.target_id;

    SELECT LEFT(cm.content, 80) INTO v_content_preview
    FROM public.chat_messages cm
    WHERE cm.id = NEW.target_id;
  END IF;

  -- If no reported user found, skip
  IF v_reported_user_id IS NULL THEN RETURN NEW; END IF;

  -- Don't notify if the reporter is reporting themselves
  IF v_reported_user_id = NEW.reporter_id THEN RETURN NEW; END IF;

  -- Build reason label
  v_reason_label := CASE NEW.reason
    WHEN 'inappropriate' THEN 'محتوى غير مناسب'
    WHEN 'harassment' THEN 'تحرش أو تنمر'
    WHEN 'spam' THEN 'رسائل مزعجة'
    WHEN 'misinformation' THEN 'معلومات مضللة'
    WHEN 'cheating' THEN 'غش أكاديمي'
    ELSE 'سبب آخر'
  END;

  -- Build target type label
  v_target_type_label := CASE NEW.target_type
    WHEN 'comment' THEN 'تعليق'
    WHEN 'message' THEN 'رسالة'
    WHEN 'user' THEN 'مستخدم'
    ELSE 'أخرى'
  END;

  -- Get report number
  v_report_num := COALESCE(NEW.report_number, NEW.id::TEXT);

  -- Build message body (each field on its own line)
  v_message_body := 'تم تقديم شكوى ضددك' || E'\n' ||
    'السبب: ' || v_reason_label || E'\n' ||
    'النوع: ' || v_target_type_label;

  -- Add subject name if available (for comment-type)
  IF v_subject_name IS NOT NULL THEN
    v_message_body := v_message_body || E'\n' || 'المقرر: ' || v_subject_name;
  END IF;

  -- Add content preview if available
  IF v_content_preview IS NOT NULL THEN
    v_message_body := v_message_body || E'\n' || 'المحتوى: "' || v_content_preview || CASE WHEN LENGTH(v_content_preview) >= 80 THEN '...' ELSE '' END || '"';
  END IF;

  -- Add report number
  v_message_body := v_message_body || E'\n' || 'رقم الشكوى: ' || v_report_num;

  -- Insert info message into report_messages
  INSERT INTO public.report_messages (report_id, sender_id, recipient_type, recipient_id, content, message_type)
  VALUES (
    NEW.id,
    NEW.reporter_id,
    'reported',
    v_reported_user_id,
    v_message_body,
    'info'
  );

  RETURN NEW;
END;
$$;

-- 4. Create trigger for auto-notify
DROP TRIGGER IF EXISTS trg_auto_notify_reported ON public.reports;
CREATE TRIGGER trg_auto_notify_reported
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_notify_reported_user();
