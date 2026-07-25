-- =====================================================
-- v60: SCORM Support — Package management, resources, and student tracking
-- Adds: scorm_packages, scorm_resources, scorm_tracking
-- Enables SCORM 1.2 and 2004 content delivery within subjects
-- =====================================================

-- =====================================================
-- 1. SCORM_PACKAGES — Stores uploaded SCORM package metadata
-- =====================================================

CREATE TABLE IF NOT EXISTS public.scorm_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.2' CHECK (version IN ('1.2', '2004')),
  manifest_xml TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  entry_point TEXT NOT NULL,
  total_objects INTEGER NOT NULL DEFAULT 0,
  package_size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for scorm_packages
CREATE INDEX IF NOT EXISTS idx_scorm_packages_subject_id ON public.scorm_packages(subject_id);
CREATE INDEX IF NOT EXISTS idx_scorm_packages_uploaded_by ON public.scorm_packages(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_scorm_packages_status ON public.scorm_packages(status);

-- Enable RLS
ALTER TABLE public.scorm_packages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scorm_packages

-- Teachers can view packages in their subjects
DROP POLICY IF EXISTS "Teachers can view scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can view scorm packages" ON public.scorm_packages
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Students can view packages in enrolled subjects
DROP POLICY IF EXISTS "Students can view scorm packages" ON public.scorm_packages;
CREATE POLICY "Students can view scorm packages" ON public.scorm_packages
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

-- Teachers can create packages for their subjects
DROP POLICY IF EXISTS "Teachers can create scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can create scorm packages" ON public.scorm_packages
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Teachers can update packages for their subjects
DROP POLICY IF EXISTS "Teachers can update scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can update scorm packages" ON public.scorm_packages
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );

-- Teachers can delete packages for their subjects
DROP POLICY IF EXISTS "Teachers can delete scorm packages" ON public.scorm_packages;
CREATE POLICY "Teachers can delete scorm packages" ON public.scorm_packages
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR public.is_admin()
  );


-- =====================================================
-- 2. SCORM_RESOURCES — Individual SCORM resources/SCO items parsed from manifest
-- =====================================================

CREATE TABLE IF NOT EXISTS public.scorm_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'sco' CHECK (type IN ('sco', 'asset')),
  href TEXT,
  scorm_type TEXT NOT NULL DEFAULT 'sco',
  parent_identifier TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  launch_url TEXT NOT NULL
);

-- Indexes for scorm_resources
CREATE INDEX IF NOT EXISTS idx_scorm_resources_package_id ON public.scorm_resources(package_id);
CREATE INDEX IF NOT EXISTS idx_scorm_resources_type ON public.scorm_resources(type);
CREATE INDEX IF NOT EXISTS idx_scorm_resources_parent_identifier ON public.scorm_resources(parent_identifier);

-- Enable RLS
ALTER TABLE public.scorm_resources ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scorm_resources

-- Teachers can view resources for packages in their subjects
DROP POLICY IF EXISTS "Teachers can view scorm resources" ON public.scorm_resources;
CREATE POLICY "Teachers can view scorm resources" ON public.scorm_resources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR public.is_admin()
      )
    )
  );

-- Students can view resources for packages in enrolled subjects
DROP POLICY IF EXISTS "Students can view scorm resources" ON public.scorm_resources;
CREATE POLICY "Students can view scorm resources" ON public.scorm_resources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
    )
  );

-- Teachers can create resources for packages in their subjects
DROP POLICY IF EXISTS "Teachers can create scorm resources" ON public.scorm_resources;
CREATE POLICY "Teachers can create scorm resources" ON public.scorm_resources
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR public.is_admin()
      )
    )
  );

-- Teachers can update resources for packages in their subjects
DROP POLICY IF EXISTS "Teachers can update scorm resources" ON public.scorm_resources;
CREATE POLICY "Teachers can update scorm resources" ON public.scorm_resources
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR public.is_admin()
      )
    )
  );

-- Teachers can delete resources for packages in their subjects
DROP POLICY IF EXISTS "Teachers can delete scorm resources" ON public.scorm_resources;
CREATE POLICY "Teachers can delete scorm resources" ON public.scorm_resources
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR public.is_admin()
      )
    )
  );


-- =====================================================
-- 3. SCORM_TRACKING — Student progress data for SCORM content
-- =====================================================

CREATE TABLE IF NOT EXISTS public.scorm_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.scorm_packages(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES public.scorm_resources(id) ON DELETE CASCADE,
  completion_status TEXT NOT NULL DEFAULT 'not_attempted' CHECK (completion_status IN ('not_attempted', 'incomplete', 'completed', 'unknown')),
  success_status TEXT NOT NULL DEFAULT 'unknown' CHECK (success_status IN ('passed', 'failed', 'unknown')),
  score_raw DECIMAL(5,2),
  score_min DECIMAL(5,2),
  score_max DECIMAL(5,2),
  score_scaled DECIMAL(5,2),
  total_time TEXT NOT NULL DEFAULT '00:00:00',
  session_time TEXT NOT NULL DEFAULT '00:00:00',
  suspend_data TEXT,
  launch_count INTEGER NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, resource_id)  -- prevent duplicate tracking per student per resource
);

-- Indexes for scorm_tracking
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_student_id ON public.scorm_tracking(student_id);
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_package_id ON public.scorm_tracking(package_id);
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_resource_id ON public.scorm_tracking(resource_id);
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_student_resource ON public.scorm_tracking(student_id, resource_id);
CREATE INDEX IF NOT EXISTS idx_scorm_tracking_last_accessed ON public.scorm_tracking(last_accessed DESC);

-- Enable RLS
ALTER TABLE public.scorm_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scorm_tracking

-- Students can read their own tracking data
DROP POLICY IF EXISTS "Students can read own scorm tracking" ON public.scorm_tracking;
CREATE POLICY "Students can read own scorm tracking" ON public.scorm_tracking
  FOR SELECT USING (student_id = auth.uid());

-- Teachers/admins can read tracking data for packages in their subjects
DROP POLICY IF EXISTS "Teachers can read scorm tracking for their subjects" ON public.scorm_tracking;
CREATE POLICY "Teachers can read scorm tracking for their subjects" ON public.scorm_tracking
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR public.is_admin()
      )
    )
  );

-- Students can insert their own tracking data for enrolled subjects
DROP POLICY IF EXISTS "Students can insert own scorm tracking" ON public.scorm_tracking;
CREATE POLICY "Students can insert own scorm tracking" ON public.scorm_tracking
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.scorm_packages p
      WHERE p.id = package_id
      AND p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
    )
  );

-- Students can update their own tracking data for enrolled subjects
DROP POLICY IF EXISTS "Students can update own scorm tracking" ON public.scorm_tracking;
CREATE POLICY "Students can update own scorm tracking" ON public.scorm_tracking
  FOR UPDATE USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());


-- =====================================================
-- 4. TRIGGERS — Auto-update updated_at timestamps
-- =====================================================

-- Trigger: auto-update updated_at for scorm_packages
DROP TRIGGER IF EXISTS trg_scorm_packages_updated_at ON public.scorm_packages;
CREATE TRIGGER trg_scorm_packages_updated_at
  BEFORE UPDATE ON public.scorm_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Trigger: auto-update updated_at for scorm_tracking
DROP TRIGGER IF EXISTS trg_scorm_tracking_updated_at ON public.scorm_tracking;
CREATE TRIGGER trg_scorm_tracking_updated_at
  BEFORE UPDATE ON public.scorm_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =====================================================
-- 5. ENABLE REALTIME for all 3 tables
-- =====================================================

ALTER TABLE public.scorm_packages REPLICA IDENTITY FULL;
ALTER TABLE public.scorm_resources REPLICA IDENTITY FULL;
ALTER TABLE public.scorm_tracking REPLICA IDENTITY FULL;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.scorm_packages; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.scorm_resources; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.scorm_tracking; EXCEPTION WHEN OTHERS THEN NULL; END $$;


-- =====================================================
-- 6. GRANT permissions
-- =====================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scorm_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scorm_resources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scorm_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.scorm_packages TO anon;
GRANT SELECT, INSERT, UPDATE ON public.scorm_resources TO anon;
GRANT SELECT, INSERT, UPDATE ON public.scorm_tracking TO anon;
