-- Scores are written only by /api/quizzes/submit (service role), which grades the answers itself.
-- Students can no longer insert score rows directly.
DROP POLICY IF EXISTS "Students can create own scores" ON public.scores;
