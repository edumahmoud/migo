DROP POLICY IF EXISTS "Non-students can find teachers" ON public.users;
DROP POLICY IF EXISTS "Users can read related profiles" ON public.users;
CREATE POLICY "Users can read related profiles" ON public.users FOR SELECT TO authenticated USING (can_view_user(id));
CREATE POLICY "Anyone authenticated can find teachers" ON public.users FOR SELECT TO authenticated USING ((role = 'teacher'::text) AND (teacher_code IS NOT NULL));
DROP FUNCTION IF EXISTS public.is_student_viewer();
