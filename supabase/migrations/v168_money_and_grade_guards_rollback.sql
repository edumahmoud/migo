DROP TRIGGER IF EXISTS aaa_guard_submission_grade ON public.submissions;
DROP FUNCTION IF EXISTS public.guard_submission_grade();
CREATE POLICY "orders_student_insert" ON public.orders FOR INSERT WITH CHECK (student_id = auth.uid());
DROP POLICY IF EXISTS "Admins update storage subscriptions" ON public.storage_subscriptions;
CREATE POLICY "Users insert own storage subscriptions" ON public.storage_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own storage subscriptions" ON public.storage_subscriptions FOR UPDATE USING ((user_id = auth.uid()) OR is_admin());
