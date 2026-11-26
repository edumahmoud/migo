-- v166: restore teacher student-search (add-student flow) after v165
CREATE OR REPLACE FUNCTION public.is_teacher() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'teacher');
$$;
REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated;
DROP POLICY IF EXISTS "Teachers can search students" ON public.users;
CREATE POLICY "Teachers can search students" ON public.users FOR SELECT TO authenticated USING (role = 'student' AND public.is_teacher());
