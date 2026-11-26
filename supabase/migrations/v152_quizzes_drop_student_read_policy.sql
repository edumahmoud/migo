-- Run only after the code that reads teacher quizzes through quizzes_safe is live.
-- Students no longer read teacher quizzes (with answer keys) directly from the base table.
DROP POLICY IF EXISTS "Students can read teacher quizzes" ON public.quizzes;
