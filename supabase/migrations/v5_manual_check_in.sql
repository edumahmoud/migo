-- =====================================================
-- Attendo - V5: Add 'manual' to check_in_method constraint
-- =====================================================
-- Allows teachers to manually register students as present

-- Drop the existing constraint and re-create with 'manual' included
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_check_in_method_check;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_check_in_method_check
  CHECK (check_in_method IN ('qr', 'gps', 'manual'));

-- Allow teachers to insert attendance records for their own sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'Teachers can insert attendance for own sessions'
  ) THEN
    CREATE POLICY "Teachers can insert attendance for own sessions"
      ON public.attendance_records
      FOR INSERT
      WITH CHECK (
        session_id IN (
          SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid()
        )
      );
  END IF;
END $$;
