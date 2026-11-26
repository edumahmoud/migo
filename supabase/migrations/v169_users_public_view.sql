-- v169: users_public: safe directory columns (no email, phone, push token, registration codes).
-- Definer view (runs as owner) filtered by relationship; teachers are visible to every signed-in user,
-- students are visible to related users and to teachers.
CREATE OR REPLACE VIEW public.users_public AS
  SELECT id, name, username, role, avatar_url, gender, title_id, teacher_code, locale, created_at, updated_at
  FROM public.users
  WHERE auth.uid() IS NOT NULL
    AND (public.can_view_user(id) OR role = 'teacher' OR (role = 'student' AND public.is_teacher()));
REVOKE ALL ON public.users_public FROM PUBLIC, anon;
GRANT SELECT ON public.users_public TO authenticated;
