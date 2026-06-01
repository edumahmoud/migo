-- Add show_review column to quizzes table
-- This separates "show results" (score display) from "show review" (question review with answers)
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS show_review BOOLEAN DEFAULT true;
