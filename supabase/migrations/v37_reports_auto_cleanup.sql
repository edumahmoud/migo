-- =====================================================
-- v37: Auto-delete old resolved/dismissed reports + DELETE RLS
-- =====================================================

-- 1. Function to auto-delete resolved/dismissed reports older than 10 days
-- Called lazily from the API on each reports list fetch, and can be called manually
CREATE OR REPLACE FUNCTION public.cleanup_old_reports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.reports
  WHERE status IN ('resolved', 'dismissed')
  AND updated_at < now() - interval '10 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 2. DELETE RLS policy on reports
-- Reporter can delete their own resolved/dismissed reports
-- Assigned user can delete resolved/dismissed reports assigned to them
-- Admin/superadmin can delete any resolved/dismissed report
DROP POLICY IF EXISTS "Users can delete completed reports" ON public.reports;
CREATE POLICY "Users can delete completed reports" ON public.reports
  FOR DELETE USING (
    (
      -- Reporter can delete their own resolved/dismissed reports
      auth.uid() = reporter_id
      AND status IN ('resolved', 'dismissed')
    )
    OR
    (
      -- Assigned user can delete resolved/dismissed reports assigned to them
      auth.uid() = assigned_to
      AND status IN ('resolved', 'dismissed')
    )
    OR
    (
      -- Admin/superadmin can delete any resolved/dismissed report
      EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      AND status IN ('resolved', 'dismissed')
    )
  );

-- 3. Try to set up pg_cron for automatic daily cleanup (may fail on some Supabase plans)
-- If pg_cron is not available, the API's lazy cleanup will handle it instead.
DO $$
BEGIN
  -- Check if pg_cron extension exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Schedule daily cleanup at 3 AM UTC
    PERFORM cron.schedule(
      'cleanup-old-reports',
      '0 3 * * *',
      $cmd$ SELECT public.cleanup_old_reports(); $cmd$
    );
    RAISE NOTICE 'pg_cron scheduled for daily report cleanup';
  ELSE
    RAISE NOTICE 'pg_cron not available, lazy API cleanup will be used';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule pg_cron, lazy API cleanup will be used';
END;
$$;
