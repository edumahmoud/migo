-- =====================================================
-- v48: Fix report notification titles — make them recipient-aware
--
-- PROBLEM: The notify_report_message() trigger sends the same title
-- "بخصوص البلاغ المقدم ضدك" to ALL recipients including the teacher/handler.
-- The teacher is NOT the accused party, so this title is wrong.
--
-- FIX: Generate different titles based on the recipient's role:
--   - المشكو ضده (reported/accused): "بخصوص شكوى مقدمة ضدك"
--   - الشاكي (reporter): "بخصوص شكواك المقدمة"
--   - المعالج (handler/teacher): "بخصوص شكوى من [الشاكي] ضد [المشكو ضده]"
-- All titles include the report number for disambiguation.
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_report_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report RECORD;
  v_reporter_name TEXT;
  v_reported_name TEXT;
  v_notif_title TEXT;
  v_notif_message TEXT;
  v_report_num TEXT;
  v_is_reporter BOOLEAN;
  v_is_reported BOOLEAN;
BEGIN
  -- Only act on new messages
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  -- Get report details
  SELECT * INTO v_report FROM public.reports WHERE id = NEW.report_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get report number
  v_report_num := COALESCE(v_report.report_number, v_report.id::TEXT);

  -- Get reporter name
  SELECT name INTO v_reporter_name FROM public.users WHERE id = v_report.reporter_id;

  -- Get reported/accused user name based on target_type
  IF v_report.target_type = 'user' AND v_report.target_id IS NOT NULL THEN
    SELECT name INTO v_reported_name FROM public.users WHERE id = v_report.target_id;
  ELSIF v_report.target_type = 'comment' AND v_report.target_id IS NOT NULL THEN
    SELECT u.name INTO v_reported_name
    FROM public.video_comments vc
    JOIN public.users u ON u.id = vc.user_id
    WHERE vc.id = v_report.target_id;
  ELSIF v_report.target_type = 'message' AND v_report.target_id IS NOT NULL THEN
    SELECT u.name INTO v_reported_name
    FROM public.chat_messages cm
    JOIN public.users u ON u.id = cm.sender_id
    WHERE cm.id = v_report.target_id;
  END IF;

  -- Determine recipient's role in this complaint
  v_is_reporter := (NEW.recipient_id = v_report.reporter_id);

  -- Check if recipient is the reported/accused user
  IF v_report.target_type = 'user' THEN
    v_is_reported := (NEW.recipient_id = v_report.target_id);
  ELSIF v_report.target_type = 'comment' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.video_comments WHERE id = v_report.target_id AND user_id = NEW.recipient_id
    ) INTO v_is_reported;
  ELSIF v_report.target_type = 'message' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.chat_messages WHERE id = v_report.target_id AND sender_id = NEW.recipient_id
    ) INTO v_is_reported;
  ELSE
    v_is_reported := FALSE;
  END IF;

  -- Generate recipient-appropriate title
  IF v_is_reported THEN
    -- المشكو ضده (the accused): keep original phrasing
    v_notif_title := 'بخصوص شكوى مقدمة ضدك (' || v_report_num || ')';
  ELSIF v_is_reporter THEN
    -- الشاكي (the reporter): "regarding your complaint"
    v_notif_title := 'بخصوص شكواك المقدمة (' || v_report_num || ')';
  ELSE
    -- المعالج (handler/teacher/supervisor): "regarding a complaint from X against Y"
    v_notif_title := 'بخصوص شكوى من ' || COALESCE(v_reporter_name, 'مستخدم')
      || ' ضد ' || COALESCE(v_reported_name, 'مستخدم')
      || ' (' || v_report_num || ')';
  END IF;

  -- Build notification message (truncate if too long)
  v_notif_message := LEFT(NEW.content, 200);

  -- Insert notification
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (
    NEW.recipient_id,
    'report',
    v_notif_title,
    v_notif_message,
    'report:' || v_report.id
  );

  RETURN NEW;
END;
$$;

-- =====================================================
-- Also fix auto_notify_reported_user() notification title
-- The auto-message itself is fine, but if notify_report_message
-- was generating wrong titles for it, the fix above covers it.
-- However, we also need to notify the HANDLER (teacher/supervisor)
-- when a new report is created, separately from the auto-message
-- to the reported user.
-- =====================================================

CREATE OR REPLACE FUNCTION public.notify_handler_new_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reporter_name TEXT;
  v_reported_name TEXT;
  v_handler_id UUID;
  v_notif_title TEXT;
  v_notif_message TEXT;
  v_report_num TEXT;
  v_reason_label TEXT;
  v_target_type_label TEXT;
BEGIN
  -- Only act on new reports
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  -- Get reporter name
  SELECT name INTO v_reporter_name FROM public.users WHERE id = NEW.reporter_id;

  -- Get reported user name
  IF NEW.target_type = 'user' AND NEW.target_id IS NOT NULL THEN
    SELECT name INTO v_reported_name FROM public.users WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'comment' AND NEW.target_id IS NOT NULL THEN
    SELECT u.name INTO v_reported_name
    FROM public.video_comments vc
    JOIN public.users u ON u.id = vc.user_id
    WHERE vc.id = NEW.target_id;
  ELSIF NEW.target_type = 'message' AND NEW.target_id IS NOT NULL THEN
    SELECT u.name INTO v_reported_name
    FROM public.chat_messages cm
    JOIN public.users u ON u.id = cm.sender_id
    WHERE cm.id = NEW.target_id;
  END IF;

  -- Find the handler (teacher linked to the reporter)
  SELECT tsl.teacher_id INTO v_handler_id
  FROM public.teacher_student_links tsl
  WHERE tsl.student_id = NEW.reporter_id
  LIMIT 1;

  -- If no handler found via link, try to find teacher linked to reported user (if student)
  IF v_handler_id IS NULL THEN
    IF NEW.target_type = 'user' THEN
      SELECT tsl.teacher_id INTO v_handler_id
      FROM public.teacher_student_links tsl
      WHERE tsl.student_id = NEW.target_id
      LIMIT 1;
    ELSIF NEW.target_type = 'comment' THEN
      SELECT tsl.teacher_id INTO v_handler_id
      FROM public.video_comments vc
      JOIN public.teacher_student_links tsl ON tsl.student_id = vc.user_id
      WHERE vc.id = NEW.target_id
      LIMIT 1;
    ELSIF NEW.target_type = 'message' THEN
      SELECT tsl.teacher_id INTO v_handler_id
      FROM public.chat_messages cm
      JOIN public.teacher_student_links tsl ON tsl.student_id = cm.sender_id
      WHERE cm.id = NEW.target_id
      LIMIT 1;
    END IF;
  END IF;

  -- If still no handler found, skip (admin can see all reports anyway)
  IF v_handler_id IS NULL THEN RETURN NEW; END IF;

  -- Don't notify the handler if they are the reporter or reported
  IF v_handler_id = NEW.reporter_id THEN RETURN NEW; END IF;
  IF NEW.target_type = 'user' AND v_handler_id = NEW.target_id THEN RETURN NEW; END IF;

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

  -- Build notification
  v_notif_title := 'شكوى جديدة من ' || COALESCE(v_reporter_name, 'مستخدم')
    || ' ضد ' || COALESCE(v_reported_name, 'مستخدم')
    || ' (' || v_report_num || ')';

  v_notif_message := 'السبب: ' || v_reason_label || E'\n' ||
    'النوع: ' || v_target_type_label;

  -- Insert notification for handler
  INSERT INTO public.notifications (user_id, type, title, message, link)
  VALUES (
    v_handler_id,
    'report',
    v_notif_title,
    v_notif_message,
    'report:' || NEW.id
  );

  RETURN NEW;
END;
$$;

-- =====================================================
-- Create trigger for handler notification on new reports
-- =====================================================
DROP TRIGGER IF EXISTS trg_notify_handler_new_report ON public.reports;
CREATE TRIGGER trg_notify_handler_new_report
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_handler_new_report();
