-- =====================================================
-- Migration v46: Add reopen_count to reports
-- Track how many times a report has been reopened
-- so the UI can show "معاد فتحها" badge instead of
-- treating it as a brand-new complaint.
-- =====================================================

-- Add reopen_count column (default 0)
ALTER TABLE reports
ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN reports.reopen_count IS 'Number of times this report has been reopened after being resolved/dismissed. 0 = never reopened. UI uses this to show "معاد فتحها" badge.';
