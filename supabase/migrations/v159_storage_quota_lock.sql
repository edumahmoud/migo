-- v159: quota check takes a per-user advisory lock so concurrent uploads cannot both pass (race fix).
CREATE OR REPLACE FUNCTION public.enforce_storage_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid; v_new bigint; v_role text; v_cfg record; v_base numeric; v_extra numeric := 0; v_used numeric;
BEGIN
  IF TG_TABLE_NAME = 'user_files' THEN
    v_uid := NEW.user_id; v_new := COALESCE(NEW.file_size, 0);
  ELSE
    v_uid := NEW.uploaded_by; v_new := COALESCE(NEW.video_size, 0);
  END IF;
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  -- Serialize uploads per user (files and videos share the key): a second upload waits until the first
  -- one commits, then re-reads the used space, so two parallel uploads cannot both pass the check.
  PERFORM pg_advisory_xact_lock(hashtextextended('storage_quota:' || v_uid::text, 0));
  SELECT role INTO v_role FROM public.users WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('student', 'teacher') THEN RETURN NEW; END IF;
  SELECT * INTO v_cfg FROM public.locked_sections_config WHERE section_key = 'files';
  v_base := COALESCE(
    CASE WHEN v_role = 'student' THEN v_cfg.free_quota_mb_student ELSE v_cfg.free_quota_mb_teacher END,
    v_cfg.free_quota_mb,
    CASE WHEN v_role = 'student' THEN COALESCE(v_cfg.student_monthly_limit, 100) ELSE COALESCE(v_cfg.teacher_monthly_limit, 500) END);
  SELECT COALESCE(max(size_mb), 0) INTO v_extra FROM public.user_storage_upgrades
   WHERE user_id = v_uid AND is_active AND (expires_at IS NULL OR expires_at + interval '2 days' > now());
  SELECT COALESCE((SELECT sum(file_size) FROM public.user_files WHERE user_id = v_uid), 0)
       + COALESCE((SELECT sum(video_size) FROM public.subject_videos WHERE uploaded_by = v_uid), 0) INTO v_used;
  IF v_used + v_new > (v_base + v_extra) * 1048576 THEN
    RAISE EXCEPTION 'STORAGE_FULL: not enough storage space' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$f$;
NOTIFY pgrst, 'reload schema';
