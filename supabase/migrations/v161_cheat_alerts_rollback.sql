SELECT cron.unschedule('cheat_daily_summary');
DROP TRIGGER IF EXISTS trg_cheat_attendance ON public.attendance_records;
DROP TRIGGER IF EXISTS trg_cheat_quiz ON public.scores;
DROP FUNCTION IF EXISTS public.trg_cheat_attendance(), public.trg_cheat_quiz(), public.cheat_daily_summary(), public.cheat_evaluate(text,uuid,uuid,uuid,text,timestamptz), public.cheat_raise(text,text,text,uuid,text,uuid,uuid,text,uuid,uuid,text,jsonb), public.cheat_teacher_ids(uuid), public.device_register(uuid,text,text,text,text,text,text,text);
DROP TABLE IF EXISTS public.cheat_alerts, public.cheat_activity, public.device_accounts, public.device_registry;
