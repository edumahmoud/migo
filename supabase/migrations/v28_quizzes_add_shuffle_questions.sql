-- Add shuffle_questions field to quizzes table
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT true;
