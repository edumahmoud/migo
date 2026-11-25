-- v145: optional paging for quizzes with more than 5 questions (questions shown N per page).
-- NULL or 1 = one question at a time (previous behavior).
-- Rollback at the bottom (commented).

ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS questions_per_page INT
  CHECK (questions_per_page IS NULL OR (questions_per_page >= 1 AND questions_per_page <= 50));

-- ROLLBACK:
-- ALTER TABLE public.quizzes DROP COLUMN IF EXISTS questions_per_page;
