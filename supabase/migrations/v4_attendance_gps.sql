-- =====================================================
-- Examy - V4: Add GPS and check_in_method to attendance
-- =====================================================
-- Idempotent migration: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

-- Add teacher GPS location to attendance_sessions
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS teacher_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS teacher_longitude DOUBLE PRECISION;

-- Add student GPS location and check_in_method to attendance_records
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS student_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS student_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_method TEXT CHECK (check_in_method IN ('qr', 'gps'));

-- Enable realtime for attendance_records (students check in)
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.attendance_records;

-- RLS policies for attendance_records (allow students to insert their own records)
DO $$ BEGIN
  -- Allow students to insert their own attendance records
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'Students can insert own attendance'
  ) THEN
    CREATE POLICY "Students can insert own attendance"
      ON public.attendance_records
      FOR INSERT
      WITH CHECK (auth.uid() = student_id);
  END IF;

  -- Allow teachers to view attendance records for their sessions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'Teachers can view session attendance'
  ) THEN
    CREATE POLICY "Teachers can view session attendance"
      ON public.attendance_records
      FOR SELECT
      USING (
        session_id IN (
          SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid()
        )
      );
  END IF;

  -- Allow students to view their own attendance records
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'Students can view own attendance'
  ) THEN
    CREATE POLICY "Students can view own attendance"
      ON public.attendance_records
      FOR SELECT
      USING (auth.uid() = student_id);
  END IF;
END $$;
