-- =====================================================
-- v136: Quiz Difficulty Levels Strategy + Bank Dedup Protection
--
-- 1. bank_questions.difficulty: add 'very_hard' level
-- 2. bank_questions.fingerprint: normalized-text hash for fast duplicate lookup
-- 3. question_banks.dedup_enabled: per-bank duplicate protection toggle (default ON)
-- 4. quizzes.difficulty_mode + quizzes.content_scope: generation metadata
--    (difficulty_mode: easy|medium|hard|very_hard|mixed — 'mixed' means a
--    teacher-controlled combination; content_scope: file_only|beyond_file,
--    where beyond_file is only ever applied to hard/very_hard questions)
-- =====================================================

-- 1) Extend the difficulty CHECK to include 'very_hard'
ALTER TABLE public.bank_questions DROP CONSTRAINT IF EXISTS bank_questions_difficulty_check;
ALTER TABLE public.bank_questions ADD CONSTRAINT bank_questions_difficulty_check
  CHECK (difficulty IN ('easy', 'medium', 'hard', 'very_hard'));

-- 2) Fingerprint column for O(1) exact-duplicate lookups within a bank
ALTER TABLE public.bank_questions ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_fingerprint
  ON public.bank_questions(bank_id, fingerprint);

-- 3) Per-bank duplicate protection toggle
ALTER TABLE public.question_banks ADD COLUMN IF NOT EXISTS dedup_enabled BOOLEAN NOT NULL DEFAULT true;

-- 4) Quiz generation metadata (informational — kept on the quiz row)
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS difficulty_mode TEXT;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS content_scope TEXT;
