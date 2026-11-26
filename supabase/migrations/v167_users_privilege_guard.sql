-- v167: block self privilege escalation on public.users (students could set their own role)
CREATE OR REPLACE FUNCTION public.guard_users_privileged_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / SQL editor / server routes
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin')) THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.account_status IS DISTINCT FROM OLD.account_status
     OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     OR NEW.auto_payout_enabled IS DISTINCT FROM OLD.auto_payout_enabled
     OR NEW.phone_verified IS DISTINCT FROM OLD.phone_verified
     OR NEW.teacher_code IS DISTINCT FROM OLD.teacher_code
     OR NEW.student_code IS DISTINCT FROM OLD.student_code
     OR NEW.registration_code IS DISTINCT FROM OLD.registration_code
     OR NEW.previous_teacher_code IS DISTINCT FROM OLD.previous_teacher_code
     OR NEW.previous_student_code IS DISTINCT FROM OLD.previous_student_code
     OR NEW.previous_registration_code IS DISTINCT FROM OLD.previous_registration_code THEN
    RAISE EXCEPTION 'not allowed to change privileged profile fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aaa_guard_users_privileged ON public.users;
CREATE TRIGGER aaa_guard_users_privileged BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_users_privileged_columns();
