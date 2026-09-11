-- =====================================================
-- v63: LMS Enhancements — Units, Lesson Progress, Quiz Gating, Platform SCORM Library
-- Adds:
--   1. lesson_units — group lessons into units/modules per subject
--   2. lesson_progress — track student progress through lessons
--   3. quiz pass_threshold + lesson_id/unit_id links (gating)
--   4. lesson pass_threshold (per-lesson gate)
--   5. unit pass_threshold (per-unit gate)
--   6. scorm_package_subjects — junction for platform-level SCORM library
--   7. Make scorm_packages.subject_id nullable to allow platform-level packages
-- =====================================================

-- =====================================================
-- 1. LESSON_UNITS — Units/Modules grouping lessons within a subject
-- =====================================================

CREATE TABLE IF NOT EXISTS public.lesson_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  pass_threshold INTEGER DEFAULT 60 CHECK (pass_threshold IS NULL OR (pass_threshold >= 0 AND pass_threshold <= 100)),
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_units_subject_id ON public.lesson_units(subject_id);
CREATE INDEX IF NOT EXISTS idx_lesson_units_order ON public.lesson_units(subject_id, order_index);

ALTER TABLE public.lesson_units ENABLE ROW LEVEL SECURITY;

-- Teachers/admins can view units in subjects they teach
DROP POLICY IF EXISTS "Teachers can view lesson units" ON public.lesson_units;
CREATE POLICY "Teachers can view lesson units" ON public.lesson_units
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Students can view published units in enrolled subjects
DROP POLICY IF EXISTS "Students can view lesson units" ON public.lesson_units;
CREATE POLICY "Students can view lesson units" ON public.lesson_units
  FOR SELECT USING (
    is_published = true
    AND subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

-- Teachers can create units for their subjects
DROP POLICY IF EXISTS "Teachers can create lesson units" ON public.lesson_units;
CREATE POLICY "Teachers can create lesson units" ON public.lesson_units
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Teachers can update units for their subjects
DROP POLICY IF EXISTS "Teachers can update lesson units" ON public.lesson_units;
CREATE POLICY "Teachers can update lesson units" ON public.lesson_units
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Teachers can delete units for their subjects
DROP POLICY IF EXISTS "Teachers can delete lesson units" ON public.lesson_units;
CREATE POLICY "Teachers can delete lesson units" ON public.lesson_units
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Trigger: auto-update updated_at for lesson_units
DROP TRIGGER IF EXISTS trg_lesson_units_updated_at ON public.lesson_units;
CREATE TRIGGER trg_lesson_units_updated_at
  BEFORE UPDATE ON public.lesson_units
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Realtime
ALTER TABLE public.lesson_units REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lesson_units; EXCEPTION WHEN OTHERS THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_units TO authenticated;
GRANT SELECT ON public.lesson_units TO anon;


-- =====================================================
-- 2. LESSONS — Add unit_id + pass_threshold columns
-- =====================================================

-- Add unit_id (nullable: lessons can be standalone or assigned to a unit)
DO $$ BEGIN
  ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.lesson_units(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Add order_within_unit for ordering lessons inside a unit
DO $$ BEGIN
  ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS order_within_unit INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Add pass_threshold for lesson-level gating (NULL = no gate, just complete)
DO $$ BEGIN
  ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS pass_threshold INTEGER
    CHECK (pass_threshold IS NULL OR (pass_threshold >= 0 AND pass_threshold <= 100));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_lessons_unit_id ON public.lessons(unit_id);
CREATE INDEX IF NOT EXISTS idx_lessons_unit_order ON public.lessons(unit_id, order_within_unit) WHERE unit_id IS NOT NULL;


-- =====================================================
-- 3. LESSON_PROGRESS — Track student progress through lessons
-- =====================================================

CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES public.lesson_units(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','failed','locked')),
  score INTEGER,
  max_score INTEGER,
  score_percentage DECIMAL(5,2),
  attempts INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  time_spent_sec INTEGER NOT NULL DEFAULT 0,
  last_position JSONB,
  failure_points JSONB,  -- array of {question_id, attempt_at, score, message}
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_student ON public.lesson_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON public.lesson_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_subject ON public.lesson_progress(subject_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_unit ON public.lesson_progress(unit_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_status ON public.lesson_progress(status);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_student_lesson ON public.lesson_progress(student_id, lesson_id);

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

-- Students can read their own progress
DROP POLICY IF EXISTS "Students can read own lesson progress" ON public.lesson_progress;
CREATE POLICY "Students can read own lesson progress" ON public.lesson_progress
  FOR SELECT USING (student_id = auth.uid());

-- Teachers can read progress for lessons in their subjects
DROP POLICY IF EXISTS "Teachers can read lesson progress" ON public.lesson_progress;
CREATE POLICY "Teachers can read lesson progress" ON public.lesson_progress
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Students can insert/update their own progress
DROP POLICY IF EXISTS "Students can insert own lesson progress" ON public.lesson_progress;
CREATE POLICY "Students can insert own lesson progress" ON public.lesson_progress
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
    AND subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Students can update own lesson progress" ON public.lesson_progress;
CREATE POLICY "Students can update own lesson progress" ON public.lesson_progress
  FOR UPDATE USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- Trigger: auto-update updated_at
DROP TRIGGER IF EXISTS trg_lesson_progress_updated_at ON public.lesson_progress;
CREATE TRIGGER trg_lesson_progress_updated_at
  BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.lesson_progress REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lesson_progress; EXCEPTION WHEN OTHERS THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.lesson_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lesson_progress TO anon;


-- =====================================================
-- 4. UNIT_PROGRESS — Aggregated progress per unit (view for analytics)
-- =====================================================

CREATE OR REPLACE VIEW public.unit_progress_summary AS
SELECT
  lp.student_id,
  lu.id AS unit_id,
  lu.subject_id,
  lu.title AS unit_title,
  lu.pass_threshold AS unit_pass_threshold,
  COUNT(DISTINCT lp.lesson_id) AS total_lessons_attempted,
  COUNT(DISTINCT CASE WHEN lp.status = 'completed' THEN lp.lesson_id END) AS lessons_completed,
  COUNT(DISTINCT CASE WHEN lp.status = 'failed' THEN lp.lesson_id END) AS lessons_failed,
  AVG(lp.score_percentage) AS avg_score,
  SUM(lp.failed_attempts) AS total_failed_attempts,
  MAX(lp.last_accessed_at) AS last_accessed
FROM public.lesson_progress lp
JOIN public.lesson_units lu ON lp.unit_id = lu.id
GROUP BY lp.student_id, lu.id, lu.subject_id, lu.title, lu.pass_threshold;

GRANT SELECT ON public.unit_progress_summary TO authenticated;
GRANT SELECT ON public.unit_progress_summary TO anon;


-- =====================================================
-- 5. QUIZZES — Add pass_threshold + lesson_id + unit_id links
-- =====================================================

-- pass_threshold: percentage 0-100, NULL = no gate
DO $$ BEGIN
  ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS pass_threshold INTEGER
    CHECK (pass_threshold IS NULL OR (pass_threshold >= 0 AND pass_threshold <= 100));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Optional link to a specific lesson
DO $$ BEGIN
  ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES public.lessons(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Optional link to a specific unit
DO $$ BEGIN
  ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.lesson_units(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- is_gate: when true, this quiz gates progression to the next lesson/unit
DO $$ BEGIN
  ALTER TABLE public.quizzes ADD COLUMN IF NOT EXISTS is_gate BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_quizzes_lesson_id ON public.quizzes(lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_unit_id ON public.quizzes(unit_id) WHERE unit_id IS NOT NULL;


-- =====================================================
-- 6. SCORM — Platform-level library: make subject_id nullable + add junction table
-- =====================================================

-- Allow platform-level packages (subject_id NULL = global library)
DO $$ BEGIN
  ALTER TABLE public.scorm_packages ALTER COLUMN subject_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Add is_platform_library flag for clarity
DO $$ BEGIN
  ALTER TABLE public.scorm_packages ADD COLUMN IF NOT EXISTS is_platform_library BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- =====================================================
-- 7. SCORM_PACKAGE_SUBJECTS — Junction table for many-to-many linking
-- =====================================================

CREATE TABLE IF NOT EXISTS public.scorm_package_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  linked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(package_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_scorm_pkg_subjects_package ON public.scorm_package_subjects(package_id);
CREATE INDEX IF NOT EXISTS idx_scorm_pkg_subjects_subject ON public.scorm_package_subjects(subject_id);

ALTER TABLE public.scorm_package_subjects ENABLE ROW LEVEL SECURITY;

-- Teachers/admins can view links for packages they can access
DROP POLICY IF EXISTS "Teachers can view scorm package links" ON public.scorm_package_subjects;
CREATE POLICY "Teachers can view scorm package links" ON public.scorm_package_subjects
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
    OR linked_by = auth.uid()
  );

-- Students can view links for their enrolled subjects
DROP POLICY IF EXISTS "Students can view scorm package links" ON public.scorm_package_subjects;
CREATE POLICY "Students can view scorm package links" ON public.scorm_package_subjects
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

-- Teachers can link packages to subjects they own
DROP POLICY IF EXISTS "Teachers can link scorm packages" ON public.scorm_package_subjects;
CREATE POLICY "Teachers can link scorm packages" ON public.scorm_package_subjects
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Teachers can unlink from their subjects
DROP POLICY IF EXISTS "Teachers can unlink scorm packages" ON public.scorm_package_subjects;
CREATE POLICY "Teachers can unlink scorm packages" ON public.scorm_package_subjects
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

ALTER TABLE public.scorm_package_subjects REPLICA IDENTITY FULL;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.scorm_package_subjects; EXCEPTION WHEN OTHERS THEN NULL; END $$;

GRANT SELECT, INSERT, DELETE ON public.scorm_package_subjects TO authenticated;
GRANT SELECT ON public.scorm_package_subjects TO anon;


-- =====================================================
-- 8. UPDATE SCORM_PACKAGES RLS — Allow platform-level packages
-- =====================================================

-- Replace SELECT policy: allow access via direct ownership OR junction table
DROP POLICY IF EXISTS "Teachers can view scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can view scorm packages" ON public.scorm_packages
  FOR SELECT USING (
    -- Direct ownership
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    -- Platform library: admins only
    OR (subject_id IS NULL AND public.is_admin())
    -- Linked via junction table
    OR id IN (
      SELECT sps.package_id FROM public.scorm_package_subjects sps
      WHERE sps.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );

-- Students: direct enrollment OR linked via junction
DROP POLICY IF EXISTS "Students can view scorm packages" ON public.scorm_packages;
CREATE POLICY "Students can view scorm packages" ON public.scorm_packages
  FOR SELECT USING (
    -- Direct ownership
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
    -- Linked via junction table
    OR id IN (
      SELECT sps.package_id FROM public.scorm_package_subjects sps
      WHERE sps.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
    )
  );

-- Only admins/superadmins can create platform-level packages (subject_id NULL)
DROP POLICY IF EXISTS "Teachers can create scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can create scorm packages" ON public.scorm_packages
  FOR INSERT WITH CHECK (
    -- Subject-scoped package: teacher must own subject
    (subject_id IS NOT NULL AND subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid())))
    -- Platform library package: admin only
    OR (subject_id IS NULL AND public.is_admin())
    OR public.is_admin()
  );

-- Update policy: owner of subject OR admin (for platform packages)
DROP POLICY IF EXISTS "Teachers can update scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can update scorm packages" ON public.scorm_packages
  FOR UPDATE USING (
    (subject_id IS NOT NULL AND subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid())))
    OR (subject_id IS NULL AND public.is_admin())
    OR public.is_admin()
  );

-- Delete policy: owner of subject OR admin (for platform packages)
DROP POLICY IF EXISTS "Teachers can delete scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can delete scorm packages" ON public.scorm_packages
  FOR DELETE USING (
    (subject_id IS NOT NULL AND subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid())))
    OR (subject_id IS NULL AND public.is_admin())
    OR public.is_admin()
  );


-- =====================================================
-- 9. UPDATE SCORM_RESOURCES RLS — Include junction-based access
-- =====================================================

-- Teachers can view resources for packages they can access (direct OR linked)
DROP POLICY IF EXISTS "Teachers can view scorm resources" ON public.scorm_resources;
CREATE POLICY "Teachers can view scorm resources" ON public.scorm_resources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR (p.subject_id IS NULL AND public.is_admin())
        OR p.id IN (
          SELECT sps.package_id FROM public.scorm_package_subjects sps
          WHERE sps.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        )
        OR public.is_admin()
      )
    )
  );

-- Students can view resources for packages they can access (direct OR linked)
DROP POLICY IF EXISTS "Students can view scorm resources" ON public.scorm_resources;
CREATE POLICY "Students can view scorm resources" ON public.scorm_resources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
        OR p.id IN (
          SELECT sps.package_id FROM public.scorm_package_subjects sps
          WHERE sps.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
        )
      )
    )
  );


-- =====================================================
-- 10. UPDATE SCORM_TRACKING RLS — Include junction-based access
-- =====================================================

DROP POLICY IF EXISTS "Teachers can read scorm tracking for their subjects" ON public.scorm_tracking;
CREATE POLICY "Teachers can read scorm tracking for their subjects" ON public.scorm_tracking
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR (p.subject_id IS NULL AND public.is_admin())
        OR p.id IN (
          SELECT sps.package_id FROM public.scorm_package_subjects sps
          WHERE sps.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        )
        OR public.is_admin()
      )
    )
  );

DROP POLICY IF EXISTS "Students can insert own scorm tracking" ON public.scorm_tracking;
CREATE POLICY "Students can insert own scorm tracking" ON public.scorm_tracking
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
        OR p.id IN (
          SELECT sps.package_id FROM public.scorm_package_subjects sps
          WHERE sps.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
        )
      )
    )
  );


-- =====================================================
-- End of v63 migration
-- =====================================================
