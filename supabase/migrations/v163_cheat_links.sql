-- v163: notification deep link for cheat alerts opens the teacher Device alerts section. Rollback: v163_cheat_links_rollback.sql
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
            'تنبيه: اشتباه غش أو تزييف حضور', v_sum || ' (' || coalesce(p_label,'') || ')', 'cheatAlerts');
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.cheat_daily_summary() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT tid, count(*) c FROM (
      SELECT a.id, cheat_teacher_ids(a.subject_id) AS tid FROM cheat_alerts a WHERE a.severity = 'review' AND a.status = 'open' AND a.summarized_at IS NULL) x GROUP BY tid LOOP
    INSERT INTO notifications(user_id, type, title, message, link)
    VALUES (t.tid, 'system', 'ملخص تنبيهات الأجهزة', 'يوجد ' || t.c || ' تنبيه للمراجعة في قسم تنبيهات الأجهزة', 'cheatAlerts');
    n := n + 1;
  END LOOP;
  UPDATE cheat_alerts SET summarized_at = now() WHERE severity = 'review' AND status = 'open' AND summarized_at IS NULL;
  RETURN n;
END $$;
UPDATE public.notifications SET link = 'cheatAlerts' WHERE link = '/?section=cheatAlerts';
