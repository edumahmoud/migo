-- =====================================================
-- v58: Add attendance_status to attendance_records
-- Supports: present (100), late (75), partial (50), absent (0)
-- Default is 'present' for backward compatibility
-- =====================================================

-- Add attendance_status column
ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS attendance_status TEXT NOT NULL DEFAULT 'present'
CHECK (attendance_status IN ('present', 'late', 'partial', 'absent'));

-- Add comment for documentation
COMMENT ON COLUMN public.attendance_records.attendance_status IS 'Attendance quality: present=100pts, late=75pts, partial=50pts, absent=0pts';
