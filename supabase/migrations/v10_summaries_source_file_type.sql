-- =====================================================
-- V10: Add source_file_type column to summaries
-- Tracks whether the summary was created from a PDF or Word file
-- =====================================================

-- 1. Add source_file_type column (nullable, 'pdf' or 'docx')
ALTER TABLE public.summaries
ADD COLUMN IF NOT EXISTS source_file_type TEXT
CHECK (source_file_type IS NULL OR source_file_type IN ('pdf', 'docx'));

-- 2. Add comment for documentation
COMMENT ON COLUMN public.summaries.source_file_type IS 'Source file type for file-based summaries: pdf or docx. NULL for text-pasted summaries.';
