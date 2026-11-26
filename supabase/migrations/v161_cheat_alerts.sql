-- v161: device registry + cheating / fake-attendance alerts.
-- FLAG AND NOTIFY ONLY. Nothing here blocks, penalises, or changes a grade or attendance record.
-- Rollback: v161_cheat_alerts_rollback.sql

CREATE TABLE IF NOT EXISTS public.device_registry (
  device_id   text PRIMARY KEY,
  owner_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,   -- first account that signed in on this device
  label       text,
  device_type text, os_name text, browser_name text, client_type text,
  is_shared   boolean NOT NULL DEFAULT false,                         -- family / lab device: never flagged for owner mismatch
  shared_note text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  last_ip     text
);
CREATE TABLE IF NOT EXISTS public.device_accounts (
  device_id  text NOT NULL REFERENCES public.device_registry(device_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  uses       int NOT NULL DEFAULT 1,
  PRIMARY KEY (device_id, user_id)
);
-- what each account did, from which device, inside an exam or attendance session
CREATE TABLE IF NOT EXISTS public.cheat_activity (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  context_type text NOT NULL CHECK (context_type IN ('attendance','quiz')),
  context_id   uuid NOT NULL,
  user_id      uuid NOT NULL,
  device_id    text NOT NULL,
  ip_address   text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cheat_activity_ctx ON public.cheat_activity(context_type, context_id);
CREATE TABLE IF NOT EXISTS public.cheat_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  kind             text NOT NULL,   -- device_owner_mismatch | device_shared_in_session | account_on_two_devices | unusual_device | many_devices_or_ips
  severity         text NOT NULL CHECK (severity IN ('strong','review')),
  context_type     text NOT NULL CHECK (context_type IN ('attendance','quiz')),
  context_id       uuid NOT NULL,
  context_label    text,
  subject_id       uuid,
  account_id       uuid,            -- the account that was used
  device_id        text,
  device_owner_id  uuid,            -- registered owner of that device
  device_label     text,
  other_account_id uuid,
  other_device_id  text,
  other_device_label text,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary          text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','false_alarm')),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  summarized_at    timestamptz,
  dedup_key        text NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cheat_alerts_subject ON public.cheat_alerts(subject_id, created_at DESC);
ALTER TABLE public.device_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheat_activity  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheat_alerts    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_registry, public.device_accounts, public.cheat_activity, public.cheat_alerts FROM anon, authenticated;

-- Called by the login endpoint (service role) after a successful sign-in.
CREATE OR REPLACE FUNCTION public.device_register(p_user uuid, p_device text, p_ip text, p_label text, p_dtype text, p_os text, p_browser text, p_client text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_device IS NULL OR p_device = '' OR p_user IS NULL THEN RETURN; END IF;
  INSERT INTO device_registry(device_id, owner_id, label, device_type, os_name, browser_name, client_type, last_ip)
  VALUES (p_device, p_user, p_label, p_dtype, p_os, p_browser, p_client, p_ip)
  ON CONFLICT (device_id) DO UPDATE SET last_seen = now(), last_ip = EXCLUDED.last_ip,
    label = coalesce(device_registry.label, EXCLUDED.label);
  INSERT INTO device_accounts(device_id, user_id) VALUES (p_device, p_user)
  ON CONFLICT (device_id, user_id) DO UPDATE SET last_seen = now(), uses = device_accounts.uses + 1;
END $$;
REVOKE ALL ON FUNCTION public.device_register(uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.device_register(uuid,text,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.cheat_teacher_ids(p_subject uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT teacher_id FROM subjects WHERE id = p_subject AND teacher_id IS NOT NULL
  UNION SELECT teacher_id FROM subject_teachers WHERE subject_id = p_subject AND teacher_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.cheat_raise(
  p_kind text, p_sev text, p_ctx_type text, p_ctx uuid, p_label text, p_subject uuid,
  p_account uuid, p_device text, p_owner uuid, p_other_account uuid, p_other_device text, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text; v_id uuid; v_acct text; v_owner text; v_other text; v_verb text; v_sum text; v_dl text; v_odl text; t uuid;
BEGIN
  v_key := md5(concat_ws('|', p_kind, p_ctx_type, p_ctx, p_account, p_device, p_other_account, p_other_device));
  SELECT coalesce(name,email) INTO v_acct FROM users WHERE id = p_account;
  SELECT coalesce(name,email) INTO v_owner FROM users WHERE id = p_owner;
  SELECT coalesce(name,email) INTO v_other FROM users WHERE id = p_other_account;
  SELECT label INTO v_dl FROM device_registry WHERE device_id = p_device;
  SELECT label INTO v_odl FROM device_registry WHERE device_id = p_other_device;
  v_verb := CASE p_ctx_type WHEN 'attendance' THEN 'سجّل الحضور' ELSE 'قدّم الامتحان' END;
  v_sum := CASE p_kind
    WHEN 'device_owner_mismatch' THEN 'جهاز ' || coalesce(v_owner,'مستخدم آخر') || ' ' || v_verb || ' بحساب ' || coalesce(v_acct,'?')
    WHEN 'device_shared_in_session' THEN 'نفس الجهاز استُخدم لحسابين في نفس الجلسة: ' || coalesce(v_acct,'?') || ' و ' || coalesce(v_other,'?')
    WHEN 'account_on_two_devices' THEN 'حساب ' || coalesce(v_acct,'?') || ' ظهر على جهازين أثناء الجلسة' || CASE WHEN v_other IS NOT NULL THEN ' (الجهاز الآخر يخص ' || v_other || ')' ELSE '' END
    WHEN 'unusual_device' THEN 'حساب ' || coalesce(v_acct,'?') || ' ' || v_verb || ' من جهاز غير معتاد له'
    ELSE 'تغيّر كثير في الأجهزة أو الـ IP لحساب ' || coalesce(v_acct,'?') || ' أثناء الجلسة' END;
  INSERT INTO cheat_alerts(kind, severity, context_type, context_id, context_label, subject_id, account_id, device_id, device_owner_id, device_label,
                           other_account_id, other_device_id, other_device_label, details, summary, dedup_key)
  VALUES (p_kind, p_sev, p_ctx_type, p_ctx, p_label, p_subject, p_account, p_device, p_owner, v_dl, p_other_account, p_other_device, v_odl, coalesce(p_details,'{}'::jsonb), v_sum, v_key)
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL OR p_sev <> 'strong' THEN RETURN; END IF;
  -- strong alerts: notify the subject's teachers in-app right away (review alerts go in the daily summary)
  FOR t IN SELECT * FROM cheat_teacher_ids(p_subject) LOOP
    INSERT INTO notifications(user_id, type, title, message, link)
    VALUES (t, CASE p_ctx_type WHEN 'attendance' THEN 'attendance' ELSE 'quiz' END,
            'تنبيه: اشتباه غش أو تزييف حضور', v_sum || ' (' || coalesce(p_label,'') || ')', '/?section=cheatAlerts');
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.cheat_raise(text,text,text,uuid,text,uuid,uuid,text,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cheat_evaluate(p_ctx_type text, p_ctx uuid, p_user uuid, p_subject uuid, p_label text, p_window_start timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h jsonb := audit_headers(); dev text; ip text; reg device_registry%ROWTYPE; r record; n int; other_owner uuid; own_uses int; other_uses int;
BEGIN
  dev := nullif(h ->> 'x-audit-device-id',''); ip := nullif(h ->> 'x-audit-ip','');
  IF dev IS NULL THEN RETURN; END IF;                       -- unknown device (old app version): nothing to compare
  SELECT * INTO reg FROM device_registry WHERE device_id = dev;

  -- Rule 2a: the device belongs to a different account
  IF reg.device_id IS NOT NULL AND reg.owner_id IS NOT NULL AND reg.owner_id <> p_user AND NOT reg.is_shared THEN
    PERFORM cheat_raise('device_owner_mismatch','strong',p_ctx_type,p_ctx,p_label,p_subject,p_user,dev,reg.owner_id,reg.owner_id,NULL,jsonb_build_object('ip',ip));
  END IF;

  -- Rule 2b: same device, another account, same session
  IF reg.device_id IS NULL OR NOT reg.is_shared THEN
    FOR r IN SELECT DISTINCT user_id FROM cheat_activity WHERE context_type = p_ctx_type AND context_id = p_ctx AND device_id = dev AND user_id <> p_user LOOP
      PERFORM cheat_raise('device_shared_in_session','strong',p_ctx_type,p_ctx,p_label,p_subject,p_user,dev,reg.owner_id,r.user_id,NULL,jsonb_build_object('ip',ip));
    END LOOP;
  END IF;

  -- Rule 1: same account on another device inside the session window (login events or earlier activity)
  FOR r IN
    SELECT DISTINCT device_id FROM (
      SELECT device_id FROM audit_events WHERE action = 'auth.login_success' AND actor_id = p_user AND device_id IS NOT NULL AND device_id <> dev AND occurred_at >= p_window_start
      UNION SELECT device_id FROM cheat_activity WHERE user_id = p_user AND context_type = p_ctx_type AND context_id = p_ctx AND device_id <> dev
    ) x LOOP
    SELECT owner_id INTO other_owner FROM device_registry WHERE device_id = r.device_id;
    PERFORM cheat_raise('account_on_two_devices', CASE WHEN other_owner IS NOT NULL AND other_owner <> p_user THEN 'strong' ELSE 'review' END,
      p_ctx_type,p_ctx,p_label,p_subject,p_user,dev,reg.owner_id,other_owner,r.device_id,jsonb_build_object('ip',ip));
  END LOOP;

  -- Unusual device: only after a baseline (3+ earlier sign-ins on other devices); a first-ever device is never flagged
  SELECT coalesce(sum(uses),0) INTO other_uses FROM device_accounts WHERE user_id = p_user AND device_id <> dev;
  SELECT coalesce(max(uses),0) INTO own_uses FROM device_accounts WHERE user_id = p_user AND device_id = dev;
  IF other_uses >= 3 AND own_uses <= 1 AND (reg.owner_id IS NULL OR reg.owner_id = p_user) THEN
    PERFORM cheat_raise('unusual_device','review',p_ctx_type,p_ctx,p_label,p_subject,p_user,dev,reg.owner_id,NULL,NULL,jsonb_build_object('ip',ip));
  END IF;

  -- Many device or IP changes by one account inside the window
  SELECT count(DISTINCT coalesce(device_id,'') || '|' || coalesce(ip_address,'')) INTO n FROM audit_events
   WHERE action = 'auth.login_success' AND actor_id = p_user AND occurred_at >= p_window_start;
  IF n >= 3 THEN
    PERFORM cheat_raise('many_devices_or_ips','review',p_ctx_type,p_ctx,p_label,p_subject,p_user,dev,reg.owner_id,NULL,NULL,jsonb_build_object('distinct_logins',n));
  END IF;

  INSERT INTO cheat_activity(context_type, context_id, user_id, device_id, ip_address) VALUES (p_ctx_type, p_ctx, p_user, dev, ip);
END $$;
REVOKE ALL ON FUNCTION public.cheat_evaluate(text,uuid,uuid,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;

-- Triggers: never allowed to break attendance or exam submission.
CREATE OR REPLACE FUNCTION public.trg_cheat_attendance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; v_label text;
BEGIN
  BEGIN
    SELECT a.subject_id, a.started_at, sub.name AS sname INTO s FROM attendance_sessions a LEFT JOIN subjects sub ON sub.id = a.subject_id WHERE a.id = NEW.session_id;
    v_label := 'حضور ' || coalesce(s.sname,'') || ' ' || to_char(s.started_at AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI');
    PERFORM cheat_evaluate('attendance', NEW.session_id, NEW.student_id, s.subject_id, v_label, s.started_at - interval '10 minutes');
  EXCEPTION WHEN others THEN RAISE WARNING 'cheat check failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cheat_attendance ON public.attendance_records;
CREATE TRIGGER trg_cheat_attendance AFTER INSERT ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.trg_cheat_attendance();

CREATE OR REPLACE FUNCTION public.trg_cheat_quiz() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record;
BEGIN
  BEGIN
    SELECT subject_id, title, duration INTO q FROM quizzes WHERE id = NEW.quiz_id;
    PERFORM cheat_evaluate('quiz', NEW.quiz_id, NEW.student_id, q.subject_id, 'امتحان ' || coalesce(q.title, NEW.quiz_title, ''), now() - make_interval(mins => coalesce(q.duration,60) + 10));
  EXCEPTION WHEN others THEN RAISE WARNING 'cheat check failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cheat_quiz ON public.scores;
CREATE TRIGGER trg_cheat_quiz AFTER INSERT ON public.scores FOR EACH ROW EXECUTE FUNCTION public.trg_cheat_quiz();

-- Daily summary of review-level alerts, one in-app notification per teacher.
CREATE OR REPLACE FUNCTION public.cheat_daily_summary() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT tid, count(*) c FROM (
      SELECT a.id, cheat_teacher_ids(a.subject_id) AS tid FROM cheat_alerts a WHERE a.severity = 'review' AND a.status = 'open' AND a.summarized_at IS NULL) x GROUP BY tid LOOP
    INSERT INTO notifications(user_id, type, title, message, link)
    VALUES (t.tid, 'system', 'ملخص تنبيهات الأجهزة', 'يوجد ' || t.c || ' تنبيه للمراجعة في قسم تنبيهات الأجهزة', '/?section=cheatAlerts');
    n := n + 1;
  END LOOP;
  UPDATE cheat_alerts SET summarized_at = now() WHERE severity = 'review' AND status = 'open' AND summarized_at IS NULL;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.cheat_daily_summary() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('cheat_daily_summary', '0 6 * * *', 'SELECT public.cheat_daily_summary()');
