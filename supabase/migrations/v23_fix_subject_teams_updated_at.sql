-- =====================================================
-- v23: Fix subject_teams missing updated_at column
-- =====================================================
-- PROBLEM: The generic update_updated_at() trigger was applied
-- to subject_teams, but the table was created WITHOUT an
-- updated_at column. This causes every UPDATE to fail with:
--   "record 'new' has no field 'updated_at'"
-- which breaks group editing in the course teams tab.
-- =====================================================

-- Add the missing updated_at column
ALTER TABLE public.subject_teams
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;

-- Ensure the trigger exists (idempotent)
DROP TRIGGER IF EXISTS trg_subject_teams_updated_at ON public.subject_teams;
CREATE TRIGGER trg_subject_teams_updated_at
  BEFORE UPDATE ON public.subject_teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
