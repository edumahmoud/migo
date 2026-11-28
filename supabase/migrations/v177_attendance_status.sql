-- v177: attendance_status was never applied on the live database (v58 missing).
-- The app selects this column, so every attendance_records query failed and attendance showed 0%.
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS attendance_status TEXT NOT NULL DEFAULT 'present'
CHECK (attendance_status IN ('present', 'late', 'partial', 'absent'));
COMMENT ON COLUMN public.attendance_records.attendance_status IS 'Attendance quality: present=100pts, late=75pts, partial=50pts, absent=0pts';
