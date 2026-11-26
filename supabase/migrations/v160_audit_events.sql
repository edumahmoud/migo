-- v160: append-only audit log (audit_events)
-- Design: one table, hash-chained, no UPDATE/DELETE/TRUNCATE (except the retention purge of rows older than 12 months),
-- written by DB triggers on sensitive tables plus the server API (login attempts). Actor and device context reaches
-- the triggers through the PostgREST request headers the server sends (x-audit-*).
-- MAC address: a browser or a server never sees a client MAC and Android 10+ randomises/blocks it, so mac_address is
-- always NULL and mac_note says why. Device identity = device_id (random per browser/app install) + IP + user agent.
-- ROLLBACK: see supabase/migrations/v160_audit_events_rollback.sql

CREATE TABLE IF NOT EXISTS public.audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  category      text NOT NULL,
  action        text NOT NULL,
  outcome       text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','failure','denied')),
  severity      text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','notice','warning','critical')),
  actor_id      uuid,
  actor_email   text,
  actor_role    text,
  target_type   text,
  target_id     text,
  target_label  text,
  reason        text,
  before_data   jsonb,
  after_data    jsonb,
  changed_fields text[],
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address    text,
  user_agent    text,
  device_type   text,
  os_name       text,
  browser_name  text,
  device_id     text,
  mac_address   text,
  mac_note      text NOT NULL DEFAULT 'not available: browsers and servers cannot read a client MAC address; Android 10+ randomises it',
  client_type   text,
  request_id    text,
  source        text NOT NULL DEFAULT 'db_trigger',
  retention_until date NOT NULL DEFAULT (current_date + 365),
  prev_hash     text,
  row_hash      text
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred ON public.audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor    ON public.audit_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_category ON public.audit_events (category, action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target   ON public.audit_events (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_ip       ON public.audit_events (ip_address);
CREATE INDEX IF NOT EXISTS idx_audit_events_seq      ON public.audit_events (seq);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_events FROM anon, authenticated;
-- no policies: only the service role (server) reads/writes.

-- ---------- context helpers ----------
CREATE OR REPLACE FUNCTION public.audit_headers() RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE h text;
BEGIN
  h := nullif(current_setting('request.headers', true), '');
  IF h IS NULL THEN RETURN '{}'::jsonb; END IF;
  RETURN h::jsonb;
EXCEPTION WHEN others THEN RETURN '{}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION public.audit_ua_device(ua text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN ua IS NULL OR ua = '' THEN 'unknown'
    WHEN ua ~* 'AttenDoApp|; wv\)|Capacitor' THEN 'mobile-app'
    WHEN ua ~* 'iPad|Tablet' THEN 'tablet'
    WHEN ua ~* 'Mobi|Android|iPhone' THEN 'mobile'
    WHEN ua ~* 'bot|curl|python|node|axios|okhttp' THEN 'bot/script'
    ELSE 'desktop' END $$;

CREATE OR REPLACE FUNCTION public.audit_ua_os(ua text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN ua IS NULL THEN NULL
    WHEN ua ~* 'Android' THEN 'Android'
    WHEN ua ~* 'iPhone|iPad|iOS' THEN 'iOS'
    WHEN ua ~* 'Windows' THEN 'Windows'
    WHEN ua ~* 'Mac OS X|Macintosh' THEN 'macOS'
    WHEN ua ~* 'Linux' THEN 'Linux'
    ELSE 'other' END $$;

CREATE OR REPLACE FUNCTION public.audit_ua_browser(ua text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN ua IS NULL THEN NULL
    WHEN ua ~* 'Edg/' THEN 'Edge'
    WHEN ua ~* 'OPR/|Opera' THEN 'Opera'
    WHEN ua ~* 'Chrome/|CriOS' THEN 'Chrome'
    WHEN ua ~* 'Firefox/' THEN 'Firefox'
    WHEN ua ~* 'Safari/' THEN 'Safari'
    ELSE 'other' END $$;

-- Remove secrets and shorten long text before it enters the log.
CREATE OR REPLACE FUNCTION public.audit_clean(j jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL THEN NULL ELSE COALESCE((
    SELECT jsonb_object_agg(k,
      CASE
        WHEN k ~* '(password|passwd|secret|token|credential|encrypted|api_?key|private_?key|signature|otp|code_hash)' THEN to_jsonb('[redacted]'::text)
        WHEN jsonb_typeof(v) = 'string' AND length(v #>> '{}') > 200 THEN to_jsonb(left(v #>> '{}', 200) || '...[truncated]')
        WHEN jsonb_typeof(v) IN ('object','array') AND length(v::text) > 400 THEN to_jsonb('[json ' || length(v::text) || ' bytes]')
        ELSE v END)
    FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb) END $$;

-- ---------- hash chain + immutability ----------
CREATE OR REPLACE FUNCTION public.audit_events_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_events_chain', 0));
  SELECT row_hash INTO prev FROM public.audit_events ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash := encode(sha256(convert_to(
    coalesce(prev,'') || '|' || NEW.seq::text || '|' || NEW.id::text || '|' || NEW.occurred_at::text || '|' ||
    NEW.category || '|' || NEW.action || '|' || NEW.outcome || '|' || coalesce(NEW.actor_id::text,'') || '|' ||
    coalesce(NEW.target_type,'') || '|' || coalesce(NEW.target_id,'') || '|' ||
    coalesce(NEW.before_data::text,'') || '|' || coalesce(NEW.after_data::text,'') || '|' ||
    coalesce(NEW.ip_address,'') || '|' || coalesce(NEW.device_id,''), 'UTF8')), 'hex');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.audit_events_block_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' AND OLD.retention_until < current_date THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_audit_events_chain ON public.audit_events;
CREATE TRIGGER trg_audit_events_chain BEFORE INSERT ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_before_insert();
DROP TRIGGER IF EXISTS trg_audit_events_no_change ON public.audit_events;
CREATE TRIGGER trg_audit_events_no_change BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_block_change();
DROP TRIGGER IF EXISTS trg_audit_events_no_truncate ON public.audit_events;
CREATE TRIGGER trg_audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_events_block_change();

-- ---------- generic row trigger ----------
-- args: category, target_type, action_prefix, watched_columns (comma list, '' = any column except updated_at)
CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat text := TG_ARGV[0]; v_type text := TG_ARGV[1]; v_pref text := TG_ARGV[2]; v_watch text := coalesce(TG_ARGV[3], '');
  h jsonb := public.audit_headers();
  o jsonb; n jsonb; row_j jsonb; k text; changed text[] := '{}';
  v_action text; v_sev text := 'notice'; v_before jsonb; v_after jsonb;
  v_actor uuid; v_ua text; v_ip text; v_target text; v_label text;
BEGIN
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;
  row_j := coalesce(n, o);

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      IF k = 'updated_at' THEN CONTINUE; END IF;
      IF v_watch <> '' AND NOT (k = ANY (string_to_array(v_watch, ','))) THEN CONTINUE; END IF;
      IF (n -> k) IS DISTINCT FROM (o -> k) THEN changed := changed || k; END IF;
    END LOOP;
    IF array_length(changed, 1) IS NULL THEN RETURN NEW; END IF;
    v_action := v_pref || '.updated';
    SELECT jsonb_object_agg(c, o -> c), jsonb_object_agg(c, n -> c) INTO v_before, v_after FROM unnest(changed) c;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := v_pref || '.created'; v_after := n;
  ELSE
    v_action := v_pref || '.deleted'; v_before := o; v_sev := 'warning';
  END IF;

  -- table-specific action names
  IF TG_TABLE_NAME = 'users' AND TG_OP = 'UPDATE' THEN
    IF 'role' = ANY (changed) THEN v_action := 'user.role_changed'; v_sev := 'critical';
    ELSIF 'account_status' = ANY (changed) THEN v_action := 'user.status_changed'; v_sev := 'warning'; END IF;
  ELSIF TG_TABLE_NAME = 'users' AND TG_OP = 'DELETE' THEN v_sev := 'critical';
  ELSIF TG_TABLE_NAME = 'banned_users' THEN
    IF TG_OP = 'INSERT' THEN v_action := 'user.banned'; v_sev := 'critical';
    ELSIF TG_OP = 'UPDATE' AND (n ->> 'is_active') = 'false' AND (o ->> 'is_active') = 'true' THEN v_action := 'user.unbanned'; v_sev := 'warning';
    ELSIF TG_OP = 'DELETE' THEN v_action := 'user.unbanned'; END IF;
  ELSIF TG_TABLE_NAME = 'orders' AND TG_OP = 'UPDATE' THEN v_sev := 'warning';
  ELSIF TG_TABLE_NAME IN ('subjects','teacher_payouts','financial_ledger') AND TG_OP = 'DELETE' THEN v_sev := 'critical';
  END IF;

  v_actor := coalesce(nullif(h ->> 'x-audit-actor-id','')::uuid, auth.uid());
  v_ua := coalesce(nullif(h ->> 'x-audit-ua',''), h ->> 'user-agent');
  v_ip := coalesce(nullif(h ->> 'x-audit-ip',''), trim(split_part(coalesce(h ->> 'x-forwarded-for',''), ',', 1)));
  v_target := coalesce(row_j ->> 'id', row_j ->> 'user_id', row_j ->> 'subject_id');
  v_label := coalesce(row_j ->> 'email', row_j ->> 'title', row_j ->> 'name', row_j ->> 'file_name');

  INSERT INTO public.audit_events (
    category, action, outcome, severity, actor_id, actor_email, actor_role, target_type, target_id, target_label,
    reason, before_data, after_data, changed_fields, metadata, ip_address, user_agent, device_type, os_name, browser_name,
    device_id, client_type, request_id, source)
  VALUES (
    v_cat, v_action, 'success', v_sev, v_actor, nullif(h ->> 'x-audit-actor-email',''), nullif(h ->> 'x-audit-actor-role',''),
    v_type, v_target, left(v_label, 200),
    nullif(row_j ->> 'reason',''), public.audit_clean(v_before), public.audit_clean(v_after), nullif(changed, '{}'),
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'via_server', (h ->> 'x-audit-actor-id') IS NOT NULL),
    nullif(v_ip,''), left(v_ua, 400), public.audit_ua_device(v_ua), public.audit_ua_os(v_ua), public.audit_ua_browser(v_ua),
    nullif(h ->> 'x-audit-device-id',''), nullif(h ->> 'x-audit-client',''), nullif(h ->> 'x-audit-request-id',''), 'db_trigger');
  RETURN coalesce(NEW, OLD);
EXCEPTION WHEN others THEN
  -- the audit write must never break the business action, but the failure is visible in the Postgres log
  RAISE WARNING 'audit_row_change failed on %: %', TG_TABLE_NAME, SQLERRM;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE OR REPLACE PROCEDURE public.audit_attach(p_table text, p_cat text, p_type text, p_pref text, p_watch text, p_ops text DEFAULT 'INSERT OR UPDATE OR DELETE')
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN RAISE NOTICE 'skip missing table %', p_table; RETURN; END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I', p_table);
  EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER %2$s ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%3$L,%4$L,%5$L,%6$L)',
                 p_table, p_ops, p_cat, p_type, p_pref, p_watch);
END $$;

CALL public.audit_attach('users',                   'user',     'user',            'user',            'role,account_status,email,name', 'INSERT OR UPDATE OR DELETE');
CALL public.audit_attach('banned_users',            'user',     'user',            'ban',             '');
CALL public.audit_attach('student_suspensions',     'user',     'user',            'suspension',      '');
CALL public.audit_attach('registration_agents',     'user',     'agent',           'agent',           '');
CALL public.audit_attach('subjects',                'content',  'subject',         'subject',         'name,title,is_active,teacher_id');
CALL public.audit_attach('subject_teachers',        'content',  'subject_teacher', 'subject_teacher', '');
CALL public.audit_attach('orders',                  'payment',  'order',           'order',           'status,gateway_id,amount');
CALL public.audit_attach('order_force_activate_audit','payment','order',           'order_force_activate','');
CALL public.audit_attach('financial_ledger',        'payment',  'ledger_entry',    'ledger',          '');
CALL public.audit_attach('payments',                'payment',  'payment',         'payment',         'status,amount');
CALL public.audit_attach('payment_gateways',        'payment',  'gateway',         'gateway',         '');
CALL public.audit_attach('teacher_payouts',         'payment',  'payout',          'payout',          'status,amount');
CALL public.audit_attach('teacher_payout_methods',  'payment',  'payout_method',   'payout_method',   '');
CALL public.audit_attach('commission_rates',        'payment',  'commission',      'commission',      '');
CALL public.audit_attach('fee_catalog',             'payment',  'fee',             'fee',             '');
CALL public.audit_attach('storage_plans',           'storage',  'storage_plan',    'storage_plan',    '');
CALL public.audit_attach('user_storage_upgrades',   'storage',  'storage_upgrade', 'storage_upgrade', 'plan_id,size_mb,is_active,expires_at,price');
CALL public.audit_attach('storage_subscriptions',   'storage',  'storage_sub',     'storage_subscription', 'status,plan_id,is_active,expires_at');
CALL public.audit_attach('global_section_unlocks',  'paid_service','section_unlock','section_unlock',  '');
CALL public.audit_attach('user_section_unlocks',    'paid_service','section_unlock','user_section_unlock','');
CALL public.audit_attach('locked_sections_config',  'paid_service','section_config','section_config', '');
CALL public.audit_attach('section_activation_requests','paid_service','activation_request','activation_request','status');
CALL public.audit_attach('subject_subscription_plans','paid_service','plan',       'subject_plan',    '');
CALL public.audit_attach('legal_documents',         'admin',    'legal_document',  'legal_document',  '');
CALL public.audit_attach('legal_document_versions', 'admin',    'legal_version',   'legal_version',   '', 'INSERT OR DELETE');
CALL public.audit_attach('legal_settings',          'admin',    'legal_settings',  'legal_settings',  '');
CALL public.audit_attach('platform_announcements',  'admin',    'announcement',    'platform_announcement', '');
CALL public.audit_attach('institution_settings',    'admin',    'institution',     'institution',     '');
CALL public.audit_attach('app_config',              'admin',    'config',          'app_config',      '');
CALL public.audit_attach('admin_notification_log',  'admin',    'notification',    'admin_notification', '', 'INSERT');
CALL public.audit_attach('payment_gateway_audit_log','payment', 'gateway',         'gateway_audit',   '', 'INSERT');

-- ---------- retention (12 months) ----------
CREATE OR REPLACE FUNCTION public.audit_purge_expired() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('app.audit_purge', 'on', true);
  DELETE FROM public.audit_events WHERE retention_until < current_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.audit_purge', 'off', true);
  IF n > 0 THEN
    INSERT INTO public.audit_events (category, action, severity, target_type, metadata, source)
    VALUES ('system', 'audit.retention_purge', 'notice', 'audit_events', jsonb_build_object('rows_deleted', n, 'retention_days', 365), 'cron');
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.audit_purge_expired() FROM PUBLIC, anon, authenticated;

-- ---------- integrity check ----------
CREATE OR REPLACE FUNCTION public.audit_verify_chain(p_limit int DEFAULT 200000)
RETURNS TABLE (ok boolean, checked bigint, first_bad_seq bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; prev text; first_row boolean := true; calc text; cnt bigint := 0;
BEGIN
  FOR r IN SELECT * FROM public.audit_events ORDER BY seq ASC LIMIT p_limit LOOP
    IF first_row THEN prev := r.prev_hash; first_row := false; END IF;  -- oldest kept row is the trusted anchor
    calc := encode(sha256(convert_to(
      coalesce(prev,'') || '|' || r.seq::text || '|' || r.id::text || '|' || r.occurred_at::text || '|' ||
      r.category || '|' || r.action || '|' || r.outcome || '|' || coalesce(r.actor_id::text,'') || '|' ||
      coalesce(r.target_type,'') || '|' || coalesce(r.target_id,'') || '|' ||
      coalesce(r.before_data::text,'') || '|' || coalesce(r.after_data::text,'') || '|' ||
      coalesce(r.ip_address,'') || '|' || coalesce(r.device_id,''), 'UTF8')), 'hex');
    cnt := cnt + 1;
    IF calc <> r.row_hash OR r.prev_hash IS DISTINCT FROM prev THEN
      RETURN QUERY SELECT false, cnt, r.seq; RETURN;
    END IF;
    prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT true, cnt, NULL::bigint;
END $$;
REVOKE ALL ON FUNCTION public.audit_verify_chain(int) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;
