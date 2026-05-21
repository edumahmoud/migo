-- =====================================================
-- v47: Add 'auto' message_type, update auto_notify to use 'auto',
--      add user_report_stats table for persistent complaint statistics
-- =====================================================

-- =====================================================
-- 1. Update report_messages message_type CHECK constraint to include 'auto'
-- =====================================================
ALTER TABLE public.report_messages DROP CONSTRAINT IF EXISTS report_messages_message_type_check;
ALTER TABLE public.report_messages ADD CONSTRAINT report_messages_message_type_check
  CHECK (message_type IN ('info', 'warning', 'auto'));

-- =====================================================
-- 2. Recreate auto_notify_reported_user() to use message_type = 'auto'
--    (was 'info' in v44, now 'auto' to distinguish system-generated messages)
-- =====================================================
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

  -- Insert auto-generated message into report_messages (message_type = 'auto')
  INSERT INTO public.report_messages (report_id, sender_id, recipient_type, recipient_id, content, message_type)
  VALUES (
    NEW.id,
    NEW.reporter_id,
    'reported',
    v_reported_user_id,
    v_message_body,
    'auto'
  );

  RETURN NEW;
END;
$$;

-- =====================================================
-- 3. Create user_report_stats table for persistent complaint statistics
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_report_stats (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  complaints_filed_count integer NOT NULL DEFAULT 0,
  complaints_against_count integer NOT NULL DEFAULT 0,
  total_reporters_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 4. Create increment_report_stats() trigger function
--    Single DECLARE block at the top (no nested blocks)
-- =====================================================
CREATE OR REPLACE FUNCTION public.increment_report_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reported_user_id uuid;
BEGIN
  -- Only act on new reports
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  -- Increment complaints_filed_count for the reporter
  INSERT INTO public.user_report_stats (user_id, complaints_filed_count)
  VALUES (NEW.reporter_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    complaints_filed_count = public.user_report_stats.complaints_filed_count + 1,
    updated_at = now();

  -- Resolve the reported user based on target_type
  IF NEW.target_type = 'user' THEN
    v_reported_user_id := NEW.target_id;
  ELSIF NEW.target_type = 'comment' THEN
    SELECT user_id INTO v_reported_user_id FROM public.video_comments WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'message' THEN
    SELECT sender_id INTO v_reported_user_id FROM public.chat_messages WHERE id = NEW.target_id;
  END IF;

  -- If reported user found, increment their stats
  IF v_reported_user_id IS NOT NULL THEN
    INSERT INTO public.user_report_stats (user_id, complaints_against_count)
    VALUES (v_reported_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      complaints_against_count = public.user_report_stats.complaints_against_count + 1,
      updated_at = now();

    -- Update total_reporters_count (distinct reporters for same target)
    UPDATE public.user_report_stats
    SET total_reporters_count = (
      SELECT COUNT(DISTINCT r.reporter_id)
      FROM public.reports r
      WHERE r.target_type = NEW.target_type
        AND r.target_id = NEW.target_id
        AND r.status IN ('pending', 'in_progress')
    ),
    updated_at = now()
    WHERE user_id = v_reported_user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================
-- 5. RLS policies for user_report_stats
-- =====================================================
ALTER TABLE public.user_report_stats ENABLE ROW LEVEL SECURITY;

-- Users can read their own stats
CREATE POLICY "Users can read own report stats" ON public.user_report_stats
  FOR SELECT USING (user_id = auth.uid());

-- Staff can read all stats
CREATE POLICY "Staff can read all report stats" ON public.user_report_stats
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('teacher', 'admin', 'superadmin'))
  );

-- =====================================================
-- 6. Create trigger on reports INSERT for increment_report_stats
-- =====================================================
DROP TRIGGER IF EXISTS trg_increment_report_stats ON public.reports;
CREATE TRIGGER trg_increment_report_stats
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_report_stats();

-- =====================================================
-- 7. Backfill existing data into user_report_stats
-- =====================================================
INSERT INTO public.user_report_stats (user_id, complaints_filed_count, complaints_against_count)
SELECT
  u.id,
  COALESCE((SELECT COUNT(*) FROM public.reports WHERE reporter_id = u.id), 0),
  COALESCE((SELECT COUNT(*) FROM public.reports r WHERE
    (r.target_type = 'user' AND r.target_id = u.id) OR
    (r.target_type = 'comment' AND r.target_id IN (SELECT id FROM public.video_comments WHERE user_id = u.id)) OR
    (r.target_type = 'message' AND r.target_id IN (SELECT id FROM public.chat_messages WHERE sender_id = u.id))
  ), 0)
FROM public.users u
ON CONFLICT (user_id) DO UPDATE SET
  complaints_filed_count = EXCLUDED.complaints_filed_count,
  complaints_against_count = EXCLUDED.complaints_against_count,
  updated_at = now();
