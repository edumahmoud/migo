-- v170: maintenance / debug functions must not be callable from the client API
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('export_full_schema','backfill_user_phones','cleanup_expired_analytics','cleanup_expired_rate_limits','cleanup_old_reports','auto_close_expired_polls','expire_storage_subscriptions','setup_initialize_system')
 LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
 END LOOP; END $$;
