-- =====================================================
-- Migration 009: Realtime Publication + pg_cron Jobs
--
-- Part A: Add analytics tables to Supabase Realtime
--         for client-side cache invalidation via
--         React Query.
--
-- Part B: Schedule pg_cron jobs for daily snapshots
--         and cache cleanup. CONDITIONAL: pg_cron
--         requires Supabase Pro or self-hosted.
-- =====================================================

-- ============================================
-- Part A: Realtime Publication
-- ============================================

-- Add analytics_cache to realtime publication
-- When cache entries are DELETEd (invalidation), the client
-- receives a Realtime event and triggers a React Query refetch
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.analytics_cache;

-- Add cohort_analytics_cache to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.cohort_analytics_cache;

-- NOTE: analytics_snapshots is NOT added to realtime.
-- Snapshots are immutable historical records -- no client
-- needs real-time updates when a snapshot is created.

-- ============================================
-- Part B: pg_cron Jobs (CONDITIONAL)
-- ============================================
-- These jobs require pg_cron extension.
-- If not available, use Vercel Cron + API fallback.

DO $$
BEGIN
  -- Check if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Job 1: Daily snapshot creation at 00:00 UTC
    -- Calls the analytics service to compute and store daily snapshots
    PERFORM cron.schedule(
      'analytics-daily-snapshots',
      '0 0 * * *',   -- Every day at midnight UTC
      $cmd$
        SELECT net.http_post(
          url := (SELECT value FROM public.app_config WHERE key = 'app_base_url') || '/api/analytics/snapshot',
          body := json_build_object(
            'type', 'daily',
            'source', 'pg_cron'
          )
        );
      $cmd$
    );
    RAISE NOTICE 'Scheduled daily analytics snapshot job (00:00 UTC)';

    -- Job 2: Cache cleanup at 03:00 UTC
    -- Removes expired cache entries and old snapshots
    PERFORM cron.schedule(
      'analytics-cleanup',
      '0 3 * * *',   -- Every day at 3 AM UTC
      $cmd$
        SELECT public.cleanup_expired_analytics();
      $cmd$
    );
    RAISE NOTICE 'Scheduled daily analytics cleanup job (03:00 UTC)';

  ELSE
    RAISE NOTICE 'pg_cron not available. Use Vercel Cron or manual API calls for daily snapshots and cleanup.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule pg_cron jobs: %. Use Vercel Cron or manual API calls instead.', SQLERRM;
END;
$$;
