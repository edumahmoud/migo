-- =====================================================
-- v136d: Content scope available at ALL difficulty levels
--
-- REVISION (2026-11-16): "beyond file" is no longer restricted to
-- hard/very_hard. The toggle is enabled for easy/medium/hard/very_hard/mixed
-- alike, and the AI prompt now carries a mandatory context-anchoring rule:
-- every question must stay directly related to the content's topic —
-- unrelated questions are forbidden.
--
-- This script is IDEMPOTENT and self-healing: safe to run on a database
-- that has v136 applied, partially applied, or not applied at all. It also
-- cleans up residue from an earlier draft of the v136 migration (which used
-- in_file/out_of_file enums, extra columns, and a scope-vs-difficulty CHECK
-- constraint that would now block the feature).
-- =====================================================

-- ---------- 1) Ensure the canonical v136 schema exists ----------

-- bank_questions.difficulty with 'very_hard'
ALTER TABLE public.bank_questions DROP CONSTRAINT IF EXISTS bank_questions_difficulty_check;
ALTER TABLE public.bank_questions ADD CONSTRAINT bank_questions_difficulty_check
  CHECK (difficulty IN ('easy', 'medium', 'hard', 'very_hard'));

-- bank_questions.fingerprint (dedup engine — see src/lib/question-dedup.ts)
ALTER TABLE public.bank_questions ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank_fingerprint
  ON public.bank_questions(bank_id, fingerprint);

-- question_banks.dedup_enabled (default ON)
ALTER TABLE public.question_banks ADD COLUMN IF NOT EXISTS dedup_enabled BOOLEAN NOT NULL DEFAULT true;

-- quizzes.difficulty_mode + quizzes.content_scope (informational metadata)
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS difficulty_mode TEXT;
ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS content_scope TEXT;

-- ---------- 2) Remove ANY restriction linking content_scope to difficulty ----------
-- If the earlier draft of v136 was applied, its constraint
-- quizzes_content_scope_difficulty_policy_check blocks beyond_file at
-- easy/medium. Drop it — the app no longer restricts scope by level.
ALTER TABLE public.quizzes
  DROP CONSTRAINT IF EXISTS quizzes_content_scope_difficulty_policy_check;

-- Also drop the auto-named content_scope CHECK from the draft (in_file/out_of_file)
-- so the app can write 'file_only'/'beyond_file' freely.
DO $$
DECLARE
  cs_constraint TEXT;
BEGIN
  FOR cs_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = connamespace
    WHERE rel.relname = 'quizzes'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%content_scope%'
      AND con.conname <> 'quizzes_content_scope_difficulty_policy_check'
  LOOP
    EXECUTE format('ALTER TABLE public.quizzes DROP CONSTRAINT %I', cs_constraint);
  END LOOP;
END $$;

-- Draft residue: difficulty_mode CHECK + NOT NULL/DEFAULT — normalize to plain TEXT
DO $$
DECLARE
  dm_constraint TEXT;
BEGIN
  FOR dm_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = connamespace
    WHERE rel.relname = 'quizzes'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%difficulty_mode%'
  LOOP
    EXECUTE format('ALTER TABLE public.quizzes DROP CONSTRAINT %I', dm_constraint);
  END LOOP;
END $$;
ALTER TABLE public.quizzes ALTER COLUMN difficulty_mode DROP NOT NULL;
ALTER TABLE public.quizzes ALTER COLUMN difficulty_mode DROP DEFAULT;
ALTER TABLE public.quizzes ALTER COLUMN content_scope DROP NOT NULL;
ALTER TABLE public.quizzes ALTER COLUMN content_scope DROP DEFAULT;

-- Draft wrote 'in_file' as the backfilled default — normalize to the app's enum
UPDATE public.quizzes SET content_scope = NULL WHERE content_scope NOT IN ('file_only', 'beyond_file');

-- ---------- 3) Drop draft-only columns/indexes not used by the app ----------
ALTER TABLE public.quizzes DROP COLUMN IF EXISTS mixed_distribution;
ALTER TABLE public.bank_questions DROP COLUMN IF EXISTS normalized_text;
ALTER TABLE public.bank_questions DROP COLUMN IF EXISTS dedup_meta;
ALTER TABLE public.question_banks DROP COLUMN IF EXISTS dedup_threshold;
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_mixed_distribution_only_when_mixed_check;
DROP INDEX IF EXISTS uq_bank_questions_fingerprint_per_bank;
DROP INDEX IF EXISTS idx_bank_questions_fingerprint;
DROP INDEX IF EXISTS idx_bank_questions_normalized_text;

-- ---------- 4) Comment metadata ----------
COMMENT ON COLUMN public.quizzes.content_scope IS
  'file_only = questions derived only from the uploaded material. beyond_file = questions may exceed the literal text at ANY difficulty level, but the AI prompt anchors every question to the content''s topic (no unrelated questions).';
COMMENT ON COLUMN public.quizzes.difficulty_mode IS
  'Difficulty strategy used at generation time: easy | medium | hard | very_hard | mixed (teacher-controlled per-level counts).';

-- End of v136d_scope_all_levels.sql
