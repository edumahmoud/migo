-- =============================================================
-- v132_agent_sections_restructure.sql
-- AttenDo LMS — Restructure agent allowed_sections from 18
-- sub-sections to 9 top-level sections.
--
-- Background:
--   v114 introduced `allowed_sections` on registration_agents with
--   18 sub-section ids (dashboard, subjects, students, tracking,
--   summaries, questionBank, scormLibrary, pendingOrders,
--   financialManagement, chat, videos, files, todos, calendar,
--   reports, analytics, notifications, registration).
--
--   v132 restructures the agent portal so each section is a
--   top-level sidebar entry (no more "Teacher View" wrapper).
--   11 sections are removed; 2 new sections are added (search,
--   pendingOrders is kept). The final list of 9:
--     search, pendingOrders, dashboard, subjects, students,
--     tracking, financialManagement, calendar, reports
--
-- This migration:
--   1) Updates the validate_agent_allowed_sections trigger to
--      accept only the new 9 ids.
--   2) Cleans up existing agents' allowed_sections by filtering
--      out any removed ids. If an agent's filtered list becomes
--      empty AND it was non-null before, we set it to NULL (all
--      allowed) so no agent gets accidentally locked out.
-- =============================================================

-- 1) Update the validation function to accept only v132 ids.
CREATE OR REPLACE FUNCTION public.validate_agent_allowed_sections()
RETURNS TRIGGER AS $$
DECLARE
  v_invalid INTEGER;
  v_id TEXT;
BEGIN
  IF NEW.allowed_sections IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.allowed_sections) != 'array' THEN
    RAISE EXCEPTION 'allowed_sections must be a JSON array or NULL';
  END IF;

  v_invalid := 0;
  FOR v_id IN SELECT jsonb_array_elements_text(NEW.allowed_sections)
  LOOP
    IF v_id NOT IN (
      'search','pendingOrders','dashboard','subjects','students',
      'tracking','financialManagement','calendar','reports'
    ) THEN
      v_invalid := v_invalid + 1;
    END IF;
  END LOOP;

  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'allowed_sections contains invalid section id(s). Allowed: search, pendingOrders, dashboard, subjects, students, tracking, financialManagement, calendar, reports';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Clean up existing agents' allowed_sections.
--    For each agent with a non-null allowed_sections array, filter
--    out any ids that are no longer valid. If the filtered array
--    becomes empty, set it to NULL (all allowed) to avoid locking
--    the agent out.
UPDATE public.registration_agents ra
SET allowed_sections = sub.filtered,
    updated_at = now()
FROM (
  SELECT
    ra2.id,
    CASE
      -- Filter the array to keep only valid v132 ids.
      WHEN (
        SELECT COUNT(*)
        FROM jsonb_array_elements_text(ra2.allowed_sections) AS s(id)
        WHERE s.id IN (
          'search','pendingOrders','dashboard','subjects','students',
          'tracking','financialManagement','calendar','reports'
        )
      ) = 0 THEN NULL::jsonb  -- empty after filter → all allowed
      ELSE (
        SELECT jsonb_agg(s.id)
        FROM jsonb_array_elements_text(ra2.allowed_sections) AS s(id)
        WHERE s.id IN (
          'search','pendingOrders','dashboard','subjects','students',
          'tracking','financialManagement','calendar','reports'
        )
      )
    END AS filtered
  FROM public.registration_agents ra2
  WHERE ra2.allowed_sections IS NOT NULL
    AND jsonb_typeof(ra2.allowed_sections) = 'array'
    AND jsonb_array_length(ra2.allowed_sections) > 0
) sub
WHERE ra.id = sub.id
  -- Only update if the value actually changed.
  AND ra.allowed_sections IS DISTINCT FROM sub.filtered;

COMMENT ON FUNCTION public.validate_agent_allowed_sections() IS
  'v132: Validates that allowed_sections is NULL or a JSON array of valid section ids (search, pendingOrders, dashboard, subjects, students, tracking, financialManagement, calendar, reports).';
