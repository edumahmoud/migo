-- Re-exam rule: when set, students who already have a score older than this time cannot retake,
-- even if retake is allowed. Set when a teacher reactivates a quiz for students who did not take it.
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS reexam_only_new_since timestamptz;
