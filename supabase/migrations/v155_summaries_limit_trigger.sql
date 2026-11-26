-- v155: enforce the summaries section lock + plan limit in the database too,
-- so a direct insert with a user's own login cannot go past what the API enforces.
-- Mirrors src/lib/section-usage.ts for section_key = 'summaries' (students and teachers only).
CREATE OR REPLACE FUNCTION public.enforce_summary_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_cfg record;
  v_locked boolean;
  v_unlock record;
  v_unlocked boolean := false;
  v_trial record;
  v_created timestamptz;
  v_yearly boolean := false;
  v_limit numeric;
  v_days int;
  v_personal boolean := false;
  v_used int;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = NEW.user_id;
  IF v_role IS NULL OR v_role NOT IN ('student', 'teacher') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cfg FROM public.locked_sections_config WHERE section_key = 'summaries';
  IF NOT FOUND OR NOT COALESCE(v_cfg.is_active, false) THEN
    RETURN NEW;
  END IF;

  v_locked := CASE WHEN v_role = 'student' THEN COALESCE(v_cfg.student_locked, false) ELSE COALESCE(v_cfg.teacher_locked, false) END;
  IF NOT v_locked THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_unlock FROM public.user_section_unlocks
   WHERE user_id = NEW.user_id AND section_key = 'summaries' AND is_active AND expires_at >= now()
   ORDER BY expires_at DESC LIMIT 1;
  IF FOUND THEN
    v_unlocked := true;
    v_personal := true;
    v_yearly := (v_unlock.plan_type = 'yearly');
  END IF;

  IF NOT v_unlocked THEN
    IF EXISTS (SELECT 1 FROM public.global_section_unlocks
                WHERE section_key = 'summaries' AND is_active AND expires_at >= now() AND scope = 'all') THEN
      v_unlocked := true;
    ELSE
      SELECT created_at INTO v_created FROM public.users WHERE id = NEW.user_id;
      FOR v_trial IN SELECT started_at FROM public.global_section_unlocks
                      WHERE section_key = 'summaries' AND is_active AND expires_at >= now() AND scope = 'new_users' LOOP
        IF v_created >= v_trial.started_at THEN v_unlocked := true; END IF;
      END LOOP;
    END IF;
  END IF;

  IF NOT v_unlocked THEN
    RAISE EXCEPTION 'SECTION_LOCKED: summaries is locked for this account' USING ERRCODE = 'P0001';
  END IF;

  IF v_role = 'student' THEN
    v_limit := CASE WHEN v_yearly THEN v_cfg.student_yearly_limit ELSE v_cfg.student_monthly_limit END;
  ELSE
    v_limit := CASE WHEN v_yearly THEN v_cfg.teacher_yearly_limit ELSE v_cfg.teacher_monthly_limit END;
  END IF;
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_personal THEN
    v_days := CASE WHEN v_yearly THEN 365 ELSE 30 END;
  ELSE
    v_days := COALESCE(v_cfg.usage_period_days, 30);
  END IF;

  SELECT count(*) INTO v_used FROM public.usage_events
   WHERE user_id = NEW.user_id AND source IN ('summary', 'summary_quiz')
     AND created_at >= now() - make_interval(days => v_days);

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'LIMIT_REACHED: summaries limit used up' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_summary_limit ON public.summaries;
CREATE TRIGGER trg_enforce_summary_limit BEFORE INSERT ON public.summaries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_summary_limit();
