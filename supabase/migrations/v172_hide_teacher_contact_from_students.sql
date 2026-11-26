-- v172: students can no longer read other teachers' rows in public.users (email, phone, codes).
-- Names and avatars for teachers stay available through public.users_public (v169).
CREATE OR REPLACE FUNCTION public.is_student_viewer() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'student');
$$;
REVOKE EXECUTE ON FUNCTION public.is_student_viewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_student_viewer() TO authenticated;
DROP POLICY IF EXISTS "Anyone authenticated can find teachers" ON public.users;
DROP POLICY IF EXISTS "Users can read related profiles" ON public.users;
CREATE POLICY "Users can read related profiles" ON public.users FOR SELECT TO authenticated
  USING (can_view_user(id) AND (role IS DISTINCT FROM 'teacher' OR NOT public.is_student_viewer()));
-- Non-student users (teachers, agents, admins) can still look teachers up by code
CREATE POLICY "Non-students can find teachers" ON public.users FOR SELECT TO authenticated
  USING (role = 'teacher' AND teacher_code IS NOT NULL AND NOT public.is_student_viewer());
