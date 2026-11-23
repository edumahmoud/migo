-- Attendance hardening stage A. Matched to production AttenDo on 2026-11-23.
-- Apply before app deployment. No existing policies or records are changed.
-- Stage A is additive, before deploying the app. Stage B lockdown is separate.
BEGIN;
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS teacher_accuracy double precision,
  ADD COLUMN IF NOT EXISTS teacher_location_captured_at timestamptz;
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS student_accuracy double precision,
  ADD COLUMN IF NOT EXISTS student_location_captured_at timestamptz;

CREATE OR REPLACE FUNCTION public.verified_attendance_check_in(
  p_session_id uuid, p_student_id uuid, p_method text,
  p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL, p_captured_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s public.attendance_sessions%ROWTYPE;
  distance_m double precision;
  inserted_id uuid;
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('qr', 'gps') THEN RAISE EXCEPTION 'INVALID_METHOD'; END IF;
  SELECT * INTO s FROM public.attendance_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'active' THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = s.teacher_id AND role IN ('teacher','admin','superadmin')) THEN RAISE EXCEPTION 'SESSION_CLOSED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_student_id AND role = 'student') THEN RAISE EXCEPTION 'NOT_STUDENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subject_students WHERE subject_id = s.subject_id AND student_id = p_student_id AND status = 'approved') THEN RAISE EXCEPTION 'NOT_ENROLLED'; END IF;
  IF p_method = 'gps' THEN
    IF s.teacher_latitude IS NULL OR s.teacher_longitude IS NULL OR s.teacher_accuracy IS NULL
      OR s.teacher_accuracy <= 0 OR s.teacher_accuracy > 50
      OR NOT (s.teacher_latitude BETWEEN -90 AND 90) OR NOT (s.teacher_longitude BETWEEN -180 AND 180)
      OR (s.teacher_latitude = 0 AND s.teacher_longitude = 0)
      OR s.teacher_location_captured_at IS NULL
      OR s.teacher_location_captured_at < s.started_at - interval '2 minutes'
      OR s.teacher_location_captured_at > s.started_at + interval '5 seconds'
    THEN RAISE EXCEPTION 'GPS_UNAVAILABLE'; END IF;
    IF p_latitude IS NULL OR p_longitude IS NULL OR p_accuracy IS NULL OR p_captured_at IS NULL
      OR NOT (p_latitude BETWEEN -90 AND 90) OR NOT (p_longitude BETWEEN -180 AND 180)
      OR (p_latitude = 0 AND p_longitude = 0) OR p_accuracy <= 0 OR p_accuracy > 50
      OR p_captured_at < clock_timestamp() - interval '60 seconds'
      OR p_captured_at > clock_timestamp() + interval '5 seconds'
    THEN RAISE EXCEPTION 'GPS_INVALID'; END IF;
    distance_m := 6371000 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(p_latitude - s.teacher_latitude) / 2), 2) +
      cos(radians(s.teacher_latitude)) * cos(radians(p_latitude)) *
      power(sin(radians(p_longitude - s.teacher_longitude) / 2), 2))));
    IF distance_m > 20 THEN RAISE EXCEPTION 'GPS_TOO_FAR'; END IF;
  END IF;
  INSERT INTO public.attendance_records(session_id, student_id, check_in_method, student_latitude, student_longitude, student_accuracy, student_location_captured_at)
  VALUES (p_session_id, p_student_id, p_method, CASE WHEN p_method = 'gps' THEN p_latitude END,
    CASE WHEN p_method = 'gps' THEN p_longitude END, CASE WHEN p_method = 'gps' THEN p_accuracy END,
    CASE WHEN p_method = 'gps' THEN p_captured_at END)
  ON CONFLICT (session_id, student_id) DO NOTHING RETURNING id INTO inserted_id;
  RETURN jsonb_build_object('already_registered', inserted_id IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.verified_attendance_check_in(uuid,uuid,text,double precision,double precision,double precision,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verified_attendance_check_in(uuid,uuid,text,double precision,double precision,double precision,timestamptz) TO service_role;
COMMIT;
