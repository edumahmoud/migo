-- v157: manual archive for complaints (no auto delete)
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reports_archived ON public.reports (archived_at) WHERE archived_at IS NOT NULL;

-- Audit log for archive / restore / delete (no FK so it survives the delete)
CREATE TABLE IF NOT EXISTS public.report_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  report_number text,
  action text NOT NULL CHECK (action IN ('archive','restore','delete')),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.report_audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_report_audit_log_report ON public.report_audit_log (report_id, created_at);

-- Archived complaints are hidden from direct client reads for everyone (server API only)
DROP POLICY IF EXISTS "Hide archived reports" ON public.reports;
CREATE POLICY "Hide archived reports" ON public.reports AS RESTRICTIVE FOR SELECT USING (archived_at IS NULL);
DROP POLICY IF EXISTS "Hide archived report responses" ON public.report_responses;
CREATE POLICY "Hide archived report responses" ON public.report_responses AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_responses.report_id AND r.archived_at IS NULL));
DROP POLICY IF EXISTS "Hide archived report messages" ON public.report_messages;
CREATE POLICY "Hide archived report messages" ON public.report_messages AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_messages.report_id AND r.archived_at IS NULL));

-- The v37 auto cleanup stays unscheduled and is removed so nothing can purge complaints by accident
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%cleanup_old_reports%';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DROP FUNCTION IF EXISTS public.cleanup_old_reports();
