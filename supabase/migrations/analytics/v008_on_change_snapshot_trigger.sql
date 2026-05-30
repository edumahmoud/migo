-- =====================================================
-- Migration 008: On-Change Snapshot Trigger
-- Creates an analytics snapshot when a submission
-- transitions to 'graded' status.
--
-- This trigger ONLY fires on the specific transition:
--   OLD.status != 'graded' AND NEW.status = 'graded'
-- It does NOT fire on INSERT or other UPDATEs.
--
-- IMPORTANT: Requires pg_net extension (Migration 006).
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_snapshot_on_grade_posted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_url TEXT;
  v_subject_id UUID;
BEGIN
  -- Only fire when status transitions TO 'graded'
  IF OLD.status = 'graded' OR NEW.status != 'graded' THEN
    RETURN NEW;
  END IF;

  -- Get subject_id from the assignment
  SELECT a.subject_id INTO v_subject_id
  FROM public.assignments a
  WHERE a.id = NEW.assignment_id;

  -- Invalidate cache (grade posting is a significant data change)
  PERFORM public.invalidate_analytics_cache(
    NEW.student_id,
    NULL,  -- teacher_id will be resolved by invalidate function
    v_subject_id
  );

  -- Notify analytics service to create an on_change snapshot
  -- The actual metrics computation happens in the service layer
  v_base_url := public.get_app_base_url();

  BEGIN
    PERFORM net.http_post(
      url := v_base_url || '/api/analytics/refresh',
      body := json_build_object(
        'studentId', NEW.student_id,
        'subjectId', v_subject_id,
        'reason', 'grade_posted',
        'createSnapshot', true,
        'source', 'db_trigger',
        'table', 'submissions',
        'operation', 'grade_posted'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- HTTP post failed -- cache is already invalidated
    -- Snapshot creation will happen on next daily cron run
    RAISE NOTICE 'Grade-posted snapshot HTTP notification failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Create trigger: only on UPDATE, with condition for grade transition
DROP TRIGGER IF EXISTS trg_snapshot_on_grade ON public.submissions;
CREATE TRIGGER trg_snapshot_on_grade
  AFTER UPDATE ON public.submissions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'graded')
  EXECUTE FUNCTION public.trg_snapshot_on_grade_posted();
