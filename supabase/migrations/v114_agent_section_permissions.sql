-- =============================================================
-- v114_agent_section_permissions.sql
-- AttenDo LMS — Per-agent sidebar section permissions.
--
-- Background:
--   The agent portal exposes 4 base sections (search, pending,
--   students, settings). The teacher's own dashboard exposes many
--   more (subjects, summaries, questionBank, scormLibrary,
--   registration, financialManagement, pendingOrders, chat,
--   students, tracking, videos, files, todos, calendar, reports,
--   analytics, notifications, settings).
--
--   Tasks 2 + 4 require:
--     2. Teacher can configure, per-agent, which sections the agent
--        may access.
--     4. When the agent opens their profile (settings), they see a
--        "Teacher View" that exposes the teacher's sidebar — but
--        filtered by the per-agent allowed_sections config.
--
-- Design:
--   * New column registration_agents.allowed_sections JSONB.
--   * NULL  = all sections allowed (backward compatible; the
--             historical default).
--   * []    = NO sections allowed (agent sees only the 4 base
--             portal sections; no teacher view).
--   * ['subjects','students',...] = allow only those teacher
--             sections in the agent's Teacher View.
--
--   This migration ONLY adds the column. The base 4 portal
--   sections (search/pending/students/settings) are ALWAYS allowed
--   for any active agent — they're the agent's own portal, not
--   the teacher's view. The teacher can only restrict access to
--   the TEACHER's sections shown in the agent's profile.
-- =============================================================

ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS allowed_sections JSONB DEFAULT NULL;

-- Validate that the JSON is either NULL or an array of strings.
-- Empty arrays are allowed (means "no teacher sections visible").
DROP TRIGGER IF EXISTS trg_validate_allowed_sections
  ON public.registration_agents;

CREATE OR REPLACE FUNCTION public.validate_agent_allowed_sections()
RETURNS TRIGGER AS $$
DECLARE
  n int;
BEGIN
  IF NEW.allowed_sections IS NULL THEN
    RETURN NEW;
  END IF;

  -- Must be a JSON array
  IF jsonb_typeof(NEW.allowed_sections) <> 'array' THEN
    RAISE EXCEPTION 'allowed_sections must be a JSON array or NULL';
  END IF;

  -- Every element must be a non-empty string
  SELECT count(*) INTO n
  FROM jsonb_array_elements(NEW.allowed_sections) AS e
  WHERE jsonb_typeof(e) <> 'string'
     OR e::text = '""';

  IF n > 0 THEN
    RAISE EXCEPTION 'allowed_sections array must contain only non-empty strings';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_agent_allowed_sections
  BEFORE INSERT OR UPDATE OF allowed_sections
  ON public.registration_agents
  FOR EACH ROW EXECUTE FUNCTION public.validate_agent_allowed_sections();

-- Helpful partial index: agents with non-NULL restrictions
CREATE INDEX IF NOT EXISTS idx_ra_allowed_sections
  ON public.registration_agents((allowed_sections IS NOT NULL))
  WHERE allowed_sections IS NOT NULL;

COMMENT ON COLUMN public.registration_agents.allowed_sections IS
  'JSON array of teacher section ids the agent may access in their Teacher View. NULL = all sections allowed. Empty array = no teacher sections visible.';
