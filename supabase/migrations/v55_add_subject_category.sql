-- v55: Add category column to subjects table
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;
