-- =====================================================
-- Migration 005: PostgreSQL Helper Functions
-- Cache invalidation, snapshot creation, and cleanup.
-- These are called by DB triggers and pg_cron.
-- =====================================================

-- -------------------------------------------------------
-- Function: Invalidate analytics cache for a student/teacher/subject
-- Called by DB triggers when student data changes.
-- Deletes matching cache entries from analytics_cache and
-- cohort_analytics_cache.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invalidate_analytics_cache(
  p_student_id UUID,
  p_teacher_id UUID DEFAULT NULL,
  p_subject_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Delete student-level cache entries
  DELETE FROM public.analytics_cache
  WHERE entity_id = p_student_id;

  -- 2. If teacher_id provided, invalidate their cohort cache
  IF p_teacher_id IS NOT NULL THEN
    DELETE FROM public.cohort_analytics_cache
    WHERE teacher_id = p_teacher_id;
  END IF;

  -- 3. If subject_id provided, delete subject-specific cache entries
  IF p_subject_id IS NOT NULL THEN
    DELETE FROM public.analytics_cache
    WHERE subject_id = p_subject_id;

    -- Also invalidate cohort caches that include this subject
    DELETE FROM public.cohort_analytics_cache
    WHERE subject_id = p_subject_id;
  END IF;

  -- 4. Invalidate any cohort cache that includes this student
  -- (cohort_analytics_cache.student_ids is a JSONB array of UUID strings)
  DELETE FROM public.cohort_analytics_cache
  WHERE student_ids::jsonb @> to_jsonb(p_student_id::text);
END;
$$;

-- -------------------------------------------------------
-- Function: Create an on_change snapshot
-- Called when a submission transitions to 'graded' status.
-- NOTE: The actual metrics computation happens in the
-- analytics-service.ts (TypeScript), not in PostgreSQL.
-- This function stores pre-computed metrics.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_on_change_snapshot(
  p_student_id UUID,
  p_subject_id UUID,
  p_metrics JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id UUID;
BEGIN
  INSERT INTO public.analytics_snapshots (
    student_id, subject_id, snapshot_type, metrics
  ) VALUES (
    p_student_id, p_subject_id, 'on_change', p_metrics
  ) RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

-- -------------------------------------------------------
-- Function: Cleanup expired analytics data
-- Deletes:
--   1. Expired cache entries (analytics_cache + cohort_analytics_cache)
--   2. Old snapshots (daily > 365 days, on_change > 90 days)
-- Called by pg_cron or API fallback.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_analytics()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_cache INTEGER;
  v_deleted_cohort INTEGER;
  v_deleted_daily INTEGER;
  v_deleted_on_change INTEGER;
  v_total INTEGER;
BEGIN
  -- 1. Delete expired cache entries
  DELETE FROM public.analytics_cache
  WHERE expires_at < NOW();
  GET DIAGNOSTICS v_deleted_cache = ROW_COUNT;

  -- 2. Delete expired cohort cache entries
  DELETE FROM public.cohort_analytics_cache
  WHERE expires_at < NOW();
  GET DIAGNOSTICS v_deleted_cohort = ROW_COUNT;

  -- 3. Delete old daily snapshots (> 365 days)
  DELETE FROM public.analytics_snapshots
  WHERE snapshot_type = 'daily'
    AND created_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS v_deleted_daily = ROW_COUNT;

  -- 4. Delete old on_change snapshots (> 90 days)
  DELETE FROM public.analytics_snapshots
  WHERE snapshot_type = 'on_change'
    AND created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted_on_change = ROW_COUNT;

  v_total := v_deleted_cache + v_deleted_cohort + v_deleted_daily + v_deleted_on_change;

  RETURN v_total;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.invalidate_analytics_cache(UUID, UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.insert_on_change_snapshot(UUID, UUID, JSONB) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_analytics() TO authenticated, anon, service_role;
