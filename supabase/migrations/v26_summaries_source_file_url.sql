-- =====================================================
-- V26: Add source_file_url column to summaries
-- Stores the Supabase Storage URL for the uploaded source file
-- so users can download the original file from the summary view.
-- =====================================================

-- 1. Add source_file_url column (nullable, URL string)
ALTER TABLE public.summaries
ADD COLUMN IF NOT EXISTS source_file_url TEXT;

-- 2. Add comment for documentation
COMMENT ON COLUMN public.summaries.source_file_url IS 'Public URL of the uploaded source file in Supabase Storage. NULL for text-pasted or file-not-uploaded summaries.';
