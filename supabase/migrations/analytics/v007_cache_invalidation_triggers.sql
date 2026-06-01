-- =====================================================
-- Migration 007: Cache Invalidation DB Triggers
-- Fires on attendance_records, scores, and submissions changes.
-- Uses pg_net.http_post to notify /api/analytics/refresh.
--
-- IMPORTANT: Requires pg_net extension (Migration 006).
-- If pg_net is not available, these triggers will NOT fire.
-- TTL-based cache expiry is the fallback.
--
-- ARCHITECTURE NOTE:
-- The application URL is read from a config table
-- (app_config) because pg_functions cannot access env vars.
-- You MUST insert your app URL before triggers work.
-- =====================================================

-- -------------------------------------------------------
-- Config table for trigger URLs
-- (pg_functions cannot access environment variables)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default app URL (UPDATE THIS for your deployment!)
INSERT INTO public.app_config (key, value)
VALUES ('app_base_url', 'http://localhost:3000')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- -------------------------------------------------------
-- Helper function: Get app base URL from config
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_app_base_url()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM public.app_config WHERE key = 'app_base_url';
$$;

-- -------------------------------------------------------
-- Trigger function: Invalidate on student data change
-- Rule: attendance_records, scores, submissions changes
-- invalidate student cache + cohort cache for the teacher
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_invalidate_student_data()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id UUID;
  v_subject_id UUID;
  v_teacher_id UUID;
  v_base_url TEXT;
BEGIN
  v_base_url := public.get_app_base_url();

  -- Extract student_id based on which table fired the trigger
  CASE TG_TABLE_NAME
    WHEN 'attendance_records' THEN
      v_student_id := COALESCE(NEW.student_id, OLD.student_id);
      -- Get teacher_id from the attendance session -> subject -> teacher
      SELECT s.teacher_id INTO v_teacher_id
      FROM public.attendance_sessions ast
      JOIN public.subjects s ON s.id = ast.subject_id
      WHERE ast.id = COALESCE(NEW.session_id, OLD.session_id);
      -- Get subject_id from the attendance session
      SELECT ast.subject_id INTO v_subject_id
      FROM public.attendance_sessions ast
      WHERE ast.id = COALESCE(NEW.session_id, OLD.session_id);

    WHEN 'scores' THEN
      v_student_id := COALESCE(NEW.student_id, OLD.student_id);
      v_teacher_id := COALESCE(NEW.teacher_id, OLD.teacher_id);
      -- Get subject_id from quiz -> subject
      SELECT q.subject_id INTO v_subject_id
      FROM public.quizzes q
      WHERE q.id = COALESCE(NEW.quiz_id, OLD.quiz_id);

    WHEN 'submissions' THEN
      v_student_id := COALESCE(NEW.student_id, OLD.student_id);
      -- Get teacher_id and subject_id from assignment -> subject
      SELECT a.teacher_id, a.subject_id INTO v_teacher_id, v_subject_id
      FROM public.assignments a
      WHERE a.id = COALESCE(NEW.assignment_id, OLD.assignment_id);

    ELSE
      RETURN COALESCE(NEW, OLD);
  END CASE;

  -- Invalidate cache directly (synchronous, no HTTP call needed)
  PERFORM public.invalidate_analytics_cache(v_student_id, v_teacher_id, v_subject_id);

  -- Optionally notify the analytics service via HTTP (async, best-effort)
  -- This enables eager recomputation if the service supports it
  BEGIN
    PERFORM net.http_post(
      url := v_base_url || '/api/analytics/refresh',
      body := json_build_object(
        'studentId', v_student_id,
        'teacherId', v_teacher_id,
        'subjectId', v_subject_id,
        'reason', 'data_change',
        'source', 'db_trigger',
        'table', TG_TABLE_NAME,
        'operation', TG_OP
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- HTTP post failed -- that is OK, cache is already invalidated
    -- TTL fallback will handle the rest
    RAISE NOTICE 'Analytics cache HTTP notification failed: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- -------------------------------------------------------
-- Create triggers on the 3 tables
-- -------------------------------------------------------

-- attendance_records: INSERT, UPDATE, DELETE
DROP TRIGGER IF EXISTS trg_invalidate_attendance ON public.attendance_records;
CREATE TRIGGER trg_invalidate_attendance
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.trg_invalidate_student_data();

-- scores: INSERT, UPDATE (no DELETE trigger -- scores are rarely deleted)
DROP TRIGGER IF EXISTS trg_invalidate_scores ON public.scores;
CREATE TRIGGER trg_invalidate_scores
  AFTER INSERT OR UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_invalidate_student_data();

-- submissions: INSERT, UPDATE
DROP TRIGGER IF EXISTS trg_invalidate_submissions ON public.submissions;
CREATE TRIGGER trg_invalidate_submissions
  AFTER INSERT OR UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_invalidate_student_data();
