-- Rollback for v160. Run only if the audit log must be removed.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tgrelid::regclass AS t, tgname FROM pg_trigger WHERE tgname LIKE 'trg_audit_%' AND NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', r.tgname, r.t);
  END LOOP; END $$;
DROP TABLE IF EXISTS public.audit_events;
DROP FUNCTION IF EXISTS public.audit_verify_chain(int);
DROP FUNCTION IF EXISTS public.audit_purge_expired();
DROP PROCEDURE IF EXISTS public.audit_attach(text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.audit_row_change();
DROP FUNCTION IF EXISTS public.audit_events_before_insert();
DROP FUNCTION IF EXISTS public.audit_events_block_change();
DROP FUNCTION IF EXISTS public.audit_clean(jsonb);
DROP FUNCTION IF EXISTS public.audit_ua_browser(text);
DROP FUNCTION IF EXISTS public.audit_ua_os(text);
DROP FUNCTION IF EXISTS public.audit_ua_device(text);
DROP FUNCTION IF EXISTS public.audit_headers();
SELECT cron.unschedule('audit_purge') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='audit_purge');
