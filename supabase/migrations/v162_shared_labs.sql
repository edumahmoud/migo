-- v162: shared lab devices. A device registered as a lab device, or any device on a registered lab IP/range,
-- is treated as shared: no "device belongs to someone else" alerts for it. Rollback: v162_shared_labs_rollback.sql
CREATE TABLE IF NOT EXISTS public.shared_labs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  location   text,
  notes      text,
  ip_cidr    inet,                 -- public IP of the lab (single address or range like 41.33.10.0/24); optional
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shared_labs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_labs FROM anon, authenticated;
ALTER TABLE public.device_registry ADD COLUMN IF NOT EXISTS lab_id uuid REFERENCES public.shared_labs(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_shared_context(p_device text, p_ip text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM device_registry WHERE device_id = p_device AND is_shared) THEN RETURN true; END IF;
  IF p_ip IS NOT NULL AND p_ip <> '' THEN
    RETURN EXISTS (SELECT 1 FROM shared_labs WHERE ip_cidr IS NOT NULL AND p_ip::inet <<= ip_cidr);
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.is_shared_context(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cheat_evaluate(p_ctx_type text, p_ctx uuid, p_user uuid, p_subject uuid, p_label text, p_window_start timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h jsonb := audit_headers(); dev text; ip text; reg device_registry%ROWTYPE; r record; n int; v_shared boolean; other_owner uuid; own_uses int; other_uses int;
BEGIN
  dev := nullif(h ->> 'x-audit-device-id',''); ip := nullif(h ->> 'x-audit-ip','');
  IF dev IS NULL THEN RETURN; END IF;                       -- unknown device (old app version): nothing to compare
  SELECT * INTO reg FROM device_registry WHERE device_id = dev;
  v_shared := public.is_shared_context(dev, ip);   -- registered lab device, or request from a registered lab network

  -- Rule 2a: the device belongs to a different account
  IF reg.device_id IS NOT NULL AND reg.owner_id IS NOT NULL AND reg.owner_id <> p_user AND NOT v_shared THEN
    PERFORM cheat_raise('device_owner_mismatch','strong',p_ctx_type,p_ctx,p_label,p_subject,p_user,dev,reg.owner_id,reg.owner_id,NULL,jsonb_build_object('ip',ip));
  END IF;

  -- Rule 2b: same device, another account, same session
  IF NOT v_shared THEN
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
