-- =====================================================
-- Migration v24: Add subject_id to summaries table
-- FIX #5: Links summaries to subjects for better organization
-- =====================================================

-- Add subject_id column (nullable, with FK to subjects)
ALTER TABLE public.summaries
ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL;

-- Create index for faster lookups by subject
CREATE INDEX IF NOT EXISTS idx_summaries_subject ON public.summaries(subject_id);

-- Update RLS policies to allow reading summaries by subject membership
-- (No changes needed — existing policies already filter by user_id)
