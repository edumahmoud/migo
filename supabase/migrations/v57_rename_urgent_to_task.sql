-- Migration: Replace priority 'urgent' with 'task' and category 'review' with 'task'
-- Auto-tasks now use: مهمة (task) for quizzes, تسليم (assignment) for assignments

-- Step 1: Update existing data
UPDATE public.user_todos SET priority = 'task' WHERE priority = 'urgent';
UPDATE public.user_todos SET category = 'task' WHERE category = 'review';

-- Step 2: Drop existing CHECK constraints on priority
ALTER TABLE public.user_todos DROP CONSTRAINT IF EXISTS user_todos_priority_check;
ALTER TABLE public.user_todos DROP CONSTRAINT IF EXISTS user_todos_priority_check1;

-- Step 3: Drop existing CHECK constraints on category
ALTER TABLE public.user_todos DROP CONSTRAINT IF EXISTS user_todos_category_check;
ALTER TABLE public.user_todos DROP CONSTRAINT IF EXISTS user_todos_category_check1;

-- Step 4: Add new CHECK constraints with updated values
ALTER TABLE public.user_todos ADD CONSTRAINT user_todos_priority_check
  CHECK (priority IN ('task', 'medium', 'low'));

ALTER TABLE public.user_todos ADD CONSTRAINT user_todos_category_check
  CHECK (category IN ('study', 'assignment', 'task', 'personal'));

-- Step 5: Update default priority from 'medium' (unchanged, just confirming)
-- No change needed for default since it was already 'medium'
