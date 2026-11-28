-- Rollback for v177 (drops the column again; the app would go back to showing 0% attendance)
ALTER TABLE public.attendance_records DROP COLUMN IF EXISTS attendance_status;
