-- Add quiz fields: show_results, allow_retake, subject_id, is_finished
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS show_results BOOLEAN DEFAULT true;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS allow_retake BOOLEAN DEFAULT false;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id);
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS is_finished BOOLEAN DEFAULT false;
