DROP POLICY IF EXISTS "Hide archived reports" ON public.reports;
DROP POLICY IF EXISTS "Hide archived report responses" ON public.report_responses;
DROP POLICY IF EXISTS "Hide archived report messages" ON public.report_messages;
-- columns and report_audit_log are kept (data); drop manually if wanted
