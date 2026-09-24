-- =============================================================
-- v65_agent_is_source.sql
-- AttenDo LMS — Collapse "source" + "agent" into a single entity.
--
-- Business decision: each Registration Agent IS now its own "source"
-- (center/external office). One account per agent, no separate
-- sources table needed in the UI. The agent row carries its own
-- metadata (display_name, kind, contact info) AND a direct teacher_id.
--
-- Backward compatibility:
--   * registration_sources table is NOT dropped — old rows stay.
--   * registration_agents.source_id is made NULLABLE so new agents
--     can be created without a source.
--   * Existing agents keep their source_id (for historical reference
--     and for the enrollment_source_id FK on subject_students).
--   * Existing enrollment_source_id columns on subject_students stay
--     populated for old rows; new rows have it NULL (attribution lives
--     on enrollment_agent_id only, which is the new source of truth).
--
-- New RLS path:
--   * teacher manages agents where agent.teacher_id = auth.uid()
--     (no more indirection through registration_sources).
--   * subject_students agent INSERT/SELECT policies now join via
--     agent.teacher_id directly.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Add direct teacher_id + metadata columns to registration_agents
-- -------------------------------------------------------------
ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS display_name TEXT;

ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS kind TEXT
  CHECK (kind IS NULL OR kind IN ('center','external_office','other'));

ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

ALTER TABLE public.registration_agents
  ADD COLUMN IF NOT EXISTS address TEXT;

-- -------------------------------------------------------------
-- 2. Backfill from existing registration_sources
--    (existing agents keep working — they get teacher_id,
--     display_name, kind from their source).
-- -------------------------------------------------------------
UPDATE public.registration_agents AS ra
SET
  teacher_id    = COALESCE(ra.teacher_id, rs.teacher_id),
  display_name  = COALESCE(ra.display_name, rs.name),
  kind          = COALESCE(ra.kind, rs.kind)
FROM public.registration_sources AS rs
WHERE ra.source_id = rs.id;

-- -------------------------------------------------------------
-- 3. Make source_id nullable (new agents have source_id = NULL)
-- -------------------------------------------------------------
ALTER TABLE public.registration_agents
  ALTER COLUMN source_id DROP NOT NULL;

-- -------------------------------------------------------------
-- 4. Update RLS: teacher manages agents where teacher_id = auth.uid()
--    (covers both new agents without source_id AND old agents that
--     have been backfilled with teacher_id).
-- -------------------------------------------------------------
DROP POLICY IF EXISTS rs_agents_teacher_all ON public.registration_agents;
CREATE POLICY rs_agents_teacher_all
  ON public.registration_agents FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- (rs_agents_self_read, rs_agents_admin_all stay unchanged.)

-- -------------------------------------------------------------
-- 5. Update subject_students agent policies to use agent.teacher_id
--    directly (no more source indirection).
-- -------------------------------------------------------------
DROP POLICY IF EXISTS ss_agent_insert ON public.subject_students;
CREATE POLICY ss_agent_insert
  ON public.subject_students FOR INSERT
  WITH CHECK (
    enrollment_agent_id IN (
      SELECT ra.id
      FROM public.registration_agents ra
      JOIN public.subjects s ON s.teacher_id = ra.teacher_id
      WHERE ra.user_id = auth.uid()
        AND ra.is_active = TRUE
        AND s.id = subject_id
    )
  );

DROP POLICY IF EXISTS ss_agent_read ON public.subject_students;
CREATE POLICY ss_agent_read
  ON public.subject_students FOR SELECT
  USING (
    enrollment_agent_id IN (
      SELECT ra.id
      FROM public.registration_agents ra
      JOIN public.subjects s ON s.teacher_id = ra.teacher_id
      WHERE ra.user_id = auth.uid()
        AND ra.is_active = TRUE
        AND s.id = subject_id
    )
  );

-- ss_agent_update_status stays unchanged (already keyed on user_id).

-- -------------------------------------------------------------
-- 6. Helpful index for the new teacher_id column
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_registration_agents_teacher
  ON public.registration_agents(teacher_id);

-- -------------------------------------------------------------
-- 7. Realtime publication update (table already added in v64)
-- -------------------------------------------------------------
-- (no-op; registration_agents already in supabase_realtime)
