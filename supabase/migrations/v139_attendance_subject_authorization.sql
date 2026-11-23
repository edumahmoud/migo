-- Attendance-specific subject lookup avoids nested subject RLS visibility.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_manage_attendance_subject(p_subject_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role IN ('teacher','admin','superadmin'))
    AND (EXISTS (SELECT 1 FROM public.subjects s WHERE s.id=p_subject_id AND s.teacher_id=auth.uid())
      OR EXISTS (SELECT 1 FROM public.subject_teachers st WHERE st.subject_id=p_subject_id AND st.teacher_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.can_manage_attendance_subject(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_attendance_subject(uuid) TO authenticated, service_role;
ALTER POLICY "Teachers can create attendance sessions" ON public.attendance_sessions
WITH CHECK (teacher_id=auth.uid() AND public.can_manage_attendance_subject(subject_id));
-- An owner can always close their own session, including after losing assignment.
-- Closed sessions cannot accept check-ins. Reopening still needs current access.
ALTER POLICY "Teachers can update own attendance sessions" ON public.attendance_sessions
USING (teacher_id=auth.uid())
WITH CHECK (teacher_id=auth.uid() AND (status='ended' OR public.can_manage_attendance_subject(subject_id)));
COMMIT;
