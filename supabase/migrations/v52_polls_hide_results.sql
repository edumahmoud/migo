-- v52: Add hide_results column to polls table
-- Allows teachers to hide vote percentages from voters until they choose to reveal them

ALTER TABLE public.polls
ADD COLUMN IF NOT EXISTS hide_results BOOLEAN NOT NULL DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.polls.hide_results IS 'When true, voters cannot see results/percentages until the teacher reveals them';
