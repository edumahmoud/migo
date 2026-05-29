-- v40: Add is_paused column to subjects table
-- Allows teachers to pause/activate a subject temporarily
-- When paused, students see an overlay indicating the subject is not accessible

ALTER TABLE public.subjects
ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.subjects.is_paused IS 'When true, the subject is paused and students cannot access its content. Teachers can toggle this at any time.';
