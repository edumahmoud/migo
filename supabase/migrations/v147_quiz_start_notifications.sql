-- Server-side quiz reminders: "starts in 10 minutes" and "started", once per student per quiz.
-- Runs every minute from pg_cron. Markers live on quizzes; editing the date or time resets them.
-- scheduled_date / scheduled_time are wall-clock text entered in Egypt time.
BEGIN;

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS reminder_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS start_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.quizzes_reset_notify_markers() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time THEN
    NEW.reminder_notified_at := NULL;
    NEW.start_notified_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quizzes_reset_notify_markers ON public.quizzes;
CREATE TRIGGER trg_quizzes_reset_notify_markers
  BEFORE UPDATE OF scheduled_date, scheduled_time ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION public.quizzes_reset_notify_markers();

CREATE OR REPLACE FUNCTION public.notify_quiz_schedule() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  q record;
  start_ts timestamptz;
  n int;
BEGIN
  FOR q IN
    SELECT id, title, subject_id, scheduled_date, scheduled_time, created_at, reminder_notified_at, start_notified_at
    FROM public.quizzes
    WHERE scheduled_date IS NOT NULL AND scheduled_date <> '' AND COALESCE(is_finished, false) = false
      AND (start_notified_at IS NULL OR reminder_notified_at IS NULL)
  LOOP
    BEGIN
      start_ts := ((q.scheduled_date || ' ' || COALESCE(NULLIF(q.scheduled_time, ''), '00:00'))::timestamp) AT TIME ZONE 'Africa/Cairo';
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;

    -- Reminder: from 10 minutes before the start. Skipped (but marked) when the quiz was created less than 10 min before.
    IF q.reminder_notified_at IS NULL AND now() >= start_ts - interval '10 minutes' THEN
      IF now() < start_ts AND q.created_at < start_ts - interval '10 minutes' THEN
        INSERT INTO public.notifications(user_id, type, title, message, link)
        SELECT ss.student_id, 'quiz', 'الاختبار يبدأ بعد ١٠ دقائق',
               'اختبار "' || COALESCE(q.title, '') || '" سيبدأ بعد ١٠ دقائق',
               'quiz:' || q.subject_id || ':' || q.id
        FROM public.subject_students ss
        JOIN public.users u ON u.id = ss.student_id AND u.role = 'student'
        WHERE ss.subject_id = q.subject_id AND ss.status = 'approved';
      END IF;
      UPDATE public.quizzes SET reminder_notified_at = now() WHERE id = q.id;
    END IF;

    -- Start: within 15 minutes after the start. Older quizzes are only marked, never notified late.
    IF q.start_notified_at IS NULL AND now() >= start_ts THEN
      IF now() < start_ts + interval '15 minutes' THEN
        INSERT INTO public.notifications(user_id, type, title, message, link)
        SELECT ss.student_id, 'quiz', 'بدأ الاختبار الآن!',
               'اختبار "' || COALESCE(q.title, '') || '" قد بدأ — يمكنك الدخول الآن',
               'quiz:' || q.subject_id || ':' || q.id
        FROM public.subject_students ss
        JOIN public.users u ON u.id = ss.student_id AND u.role = 'student'
        WHERE ss.subject_id = q.subject_id AND ss.status = 'approved';
      END IF;
      UPDATE public.quizzes SET start_notified_at = now(), reminder_notified_at = COALESCE(reminder_notified_at, now()) WHERE id = q.id;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.notify_quiz_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_quiz_schedule() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'quiz-schedule-notifications';
SELECT cron.schedule('quiz-schedule-notifications', '* * * * *', 'select public.notify_quiz_schedule()');
COMMIT;
