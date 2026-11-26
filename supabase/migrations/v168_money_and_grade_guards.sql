-- v168: stop clients writing money records; stop students setting their own grade
DROP POLICY IF EXISTS "orders_student_insert" ON public.orders;
DROP POLICY IF EXISTS "Users insert own storage subscriptions" ON public.storage_subscriptions;
DROP POLICY IF EXISTS "Users update own storage subscriptions" ON public.storage_subscriptions;
CREATE POLICY "Admins update storage subscriptions" ON public.storage_subscriptions FOR UPDATE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_submission_grade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.student_id = auth.uid() AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin')) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.score := NULL; NEW.feedback := NULL; NEW.graded_at := NULL; NEW.status := 'submitted';
    ELSE
      NEW.score := OLD.score; NEW.feedback := OLD.feedback; NEW.graded_at := OLD.graded_at; NEW.student_id := OLD.student_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aaa_guard_submission_grade ON public.submissions;
CREATE TRIGGER aaa_guard_submission_grade BEFORE INSERT OR UPDATE ON public.submissions FOR EACH ROW EXECUTE FUNCTION public.guard_submission_grade();
