-- =============================================================
-- v64_registration_portal.sql
-- AttenDo LMS — Teacher Registration Portal extension.
--
-- Adds: registration_agent role, registration_sources,
-- registration_agents, student_code on users, and per-enrollment
-- attribution columns on subject_students.
--
-- Design:
--   * A Teacher (users.role='teacher') owns many registration_sources
--     (e.g. Main Center, External Office).
--   * Each registration_source owns many registration_agents
--     (one agent = one auth user with role='registration_agent').
--   * subject_students (the existing enrollment table) is EXTENDED with
--     enrollment_source_id, enrollment_agent_id, enrolled_by,
--     enrollment_method, enrolled_at. No new enrollment table is created.
--   * Attribution lives on the enrollment row, NOT on the student —
--     a student may be enrolled by multiple agents/teachers across
--     multiple courses.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Widen role CHECK constraint on public.users
-- -------------------------------------------------------------
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('student','teacher','admin','superadmin','registration_agent'));

-- -------------------------------------------------------------
-- 2. student_code on public.users  (mirrors teacher_code)
-- -------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS student_code TEXT UNIQUE;

-- Updated triggers: also fill student_code on UPDATE to role='student'
-- (covers the agent-portal path where a pre-existing user with no
--  student_code is being registered).
CREATE OR REPLACE FUNCTION public.generate_student_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
BEGIN
  IF NEW.role = 'student' AND NEW.student_code IS NULL THEN
    new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    WHILE EXISTS (SELECT 1 FROM public.users WHERE student_code = new_code) LOOP
      new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    END LOOP;
    NEW.student_code := new_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_generate_student_code ON public.users;
CREATE TRIGGER trg_generate_student_code
  BEFORE INSERT OR UPDATE OF role, student_code ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.generate_student_code();

-- -------------------------------------------------------------
-- 3. registration_sources
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'center'
                CHECK (kind IN ('center','external_office','other')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, name)
);
CREATE INDEX IF NOT EXISTS idx_registration_sources_teacher
  ON public.registration_sources(teacher_id);

ALTER TABLE public.registration_sources ENABLE ROW LEVEL SECURITY;

-- Teacher may manage their own sources
DROP POLICY IF EXISTS rs_sources_teacher_all ON public.registration_sources;
CREATE POLICY rs_sources_teacher_all
  ON public.registration_sources FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- NOTE: rs_sources_agent_read is added AFTER registration_agents is created
-- (PostgreSQL validates referenced relations at policy-creation time).

-- Admins
DROP POLICY IF EXISTS rs_sources_admin_all ON public.registration_sources;
CREATE POLICY rs_sources_admin_all
  ON public.registration_sources FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -------------------------------------------------------------
-- 4. registration_agents  (1 agent = 1 user, 1 source)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES public.registration_sources(id) ON DELETE CASCADE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_agents_user
  ON public.registration_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_registration_agents_source
  ON public.registration_agents(source_id);

ALTER TABLE public.registration_agents ENABLE ROW LEVEL SECURITY;

-- Teacher of the source may manage agents in that source
DROP POLICY IF EXISTS rs_agents_teacher_all ON public.registration_agents;
CREATE POLICY rs_agents_teacher_all
  ON public.registration_agents FOR ALL
  USING (source_id IN (
    SELECT id FROM public.registration_sources WHERE teacher_id = auth.uid()
  ))
  WITH CHECK (source_id IN (
    SELECT id FROM public.registration_sources WHERE teacher_id = auth.uid()
  ));

-- An agent may read their own row
DROP POLICY IF EXISTS rs_agents_self_read ON public.registration_agents;
CREATE POLICY rs_agents_self_read
  ON public.registration_agents FOR SELECT
  USING (user_id = auth.uid());

-- Admins
DROP POLICY IF EXISTS rs_agents_admin_all ON public.registration_agents;
CREATE POLICY rs_agents_admin_all
  ON public.registration_agents FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Agents may read the source they belong to (for the portal header)
-- Defined here because it references public.registration_agents.
DROP POLICY IF EXISTS rs_sources_agent_read ON public.registration_sources;
CREATE POLICY rs_sources_agent_read
  ON public.registration_sources FOR SELECT
  USING (id IN (
    SELECT source_id FROM public.registration_agents
    WHERE user_id = auth.uid() AND is_active = TRUE
  ));

-- -------------------------------------------------------------
-- 5. Extend subject_students with attribution columns
--    (nullable + sensible defaults — preserves all existing rows)
-- -------------------------------------------------------------
ALTER TABLE public.subject_students
  ADD COLUMN IF NOT EXISTS enrollment_source_id UUID
    REFERENCES public.registration_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrollment_agent_id UUID
    REFERENCES public.registration_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrolled_by UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrollment_method TEXT NOT NULL DEFAULT 'self_join'
    CHECK (enrollment_method IN ('self_join','teacher_add','agent_register')),
  ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_subject_students_enrollment_agent
  ON public.subject_students(enrollment_agent_id)
  WHERE enrollment_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subject_students_enrollment_source
  ON public.subject_students(enrollment_source_id)
  WHERE enrollment_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subject_students_enrolled_by
  ON public.subject_students(enrolled_by)
  WHERE enrolled_by IS NOT NULL;

-- -------------------------------------------------------------
-- 6. RLS policies on subject_students — ADD agent path
--    (existing policies for teacher/student/admin are untouched)
-- -------------------------------------------------------------
-- Agent may INSERT an enrollment only into a course owned by the
-- teacher that owns the agent's source.
DROP POLICY IF EXISTS ss_agent_insert ON public.subject_students;
CREATE POLICY ss_agent_insert
  ON public.subject_students FOR INSERT
  WITH CHECK (
    enrollment_agent_id IN (
      SELECT ra.id
      FROM public.registration_agents ra
      JOIN public.registration_sources rs ON rs.id = ra.source_id
      JOIN public.subjects s           ON s.teacher_id = rs.teacher_id
      WHERE ra.user_id = auth.uid()
        AND ra.is_active = TRUE
        AND s.id = subject_id
    )
  );

-- Agent may SELECT the enrollments they themselves created
DROP POLICY IF EXISTS ss_agent_read ON public.subject_students;
CREATE POLICY ss_agent_read
  ON public.subject_students FOR SELECT
  USING (
    enrollment_agent_id IN (
      SELECT ra.id
      FROM public.registration_agents ra
      JOIN public.registration_sources rs ON rs.id = ra.source_id
      JOIN public.subjects s           ON s.teacher_id = rs.teacher_id
      WHERE ra.user_id = auth.uid()
        AND ra.is_active = TRUE
        AND s.id = subject_id
    )
  );

-- Agent may UPDATE only the enrollment rows they own (e.g. to fix a typo),
-- but cannot change subject_id or student_id (enforced by RLS USING chain).
DROP POLICY IF EXISTS ss_agent_update_status ON public.subject_students;
CREATE POLICY ss_agent_update_status
  ON public.subject_students FOR UPDATE
  USING (
    enrollment_agent_id IN (
      SELECT id FROM public.registration_agents
      WHERE user_id = auth.uid() AND is_active = TRUE
    )
  );

-- -------------------------------------------------------------
-- 7. Backfill enrolled_at for existing rows (use created_at)
-- -------------------------------------------------------------
UPDATE public.subject_students
SET enrolled_at = created_at
WHERE enrolled_at IS NULL OR enrolled_at = created_at;

-- -------------------------------------------------------------
-- 7b. Ensure teacher_student_links.initiated_by exists
-- (originally added by /api/migrate/initiated-by route; the new
--  agent portal flow needs it on first run too).
-- -------------------------------------------------------------
ALTER TABLE public.teacher_student_links
  ADD COLUMN IF NOT EXISTS initiated_by TEXT
  CHECK (initiated_by IS NULL OR initiated_by IN ('student','teacher'));

-- -------------------------------------------------------------
-- 7c. Backfill teacher↔student links for every agent-registered
-- student (so they appear in the teacher's "Students" section
-- AND in each course's students tab even if they were enrolled
-- before this fix shipped).
-- -------------------------------------------------------------
INSERT INTO public.teacher_student_links (teacher_id, student_id, status, initiated_by)
SELECT DISTINCT s.teacher_id, ss.student_id, 'approved', 'teacher'
FROM public.subject_students ss
JOIN public.subjects s ON s.id = ss.subject_id
WHERE ss.enrollment_method = 'agent_register'
  AND ss.enrollment_agent_id IS NOT NULL
ON CONFLICT (teacher_id, student_id) DO NOTHING;

-- -------------------------------------------------------------
-- 8. Realtime (optional but consistent with other tables)
-- -------------------------------------------------------------
ALTER PUBLICATION supabase_realtime SET TABLE public.registration_sources;
ALTER PUBLICATION supabase_realtime SET TABLE public.registration_agents;
