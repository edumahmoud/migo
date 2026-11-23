-- Apply only after v137 and the server check-in app are deployed and verified.
-- Exact pre-change production policy rollback is held separately.
BEGIN;
DROP POLICY IF EXISTS "Students can check in to attendance" ON public.attendance_records;
DROP POLICY IF EXISTS "Teachers can insert attendance for own sessions" ON public.attendance_records;
-- All attendance inserts now go through authenticated server routes. Manual
-- registration uses service_role, and student self-check-in uses the service-only RPC.
ALTER POLICY "Teachers can create attendance sessions" ON public.attendance_sessions
WITH CHECK (
  teacher_id = auth.uid()
  AND public.get_user_role(auth.uid()) IN ('teacher', 'admin', 'superadmin')
  AND EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = subject_id
    AND (s.teacher_id = auth.uid() OR s.id IN (SELECT public.get_teacher_subject_ids(auth.uid()))))
);
ALTER POLICY "Teachers can update own attendance sessions" ON public.attendance_sessions
USING (teacher_id = auth.uid() AND public.get_user_role(auth.uid()) IN ('teacher', 'admin', 'superadmin'))
WITH CHECK (
  teacher_id = auth.uid()
  AND public.get_user_role(auth.uid()) IN ('teacher', 'admin', 'superadmin')
  AND EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = subject_id
    AND (s.teacher_id = auth.uid() OR s.id IN (SELECT public.get_teacher_subject_ids(auth.uid()))))
);
COMMIT;
