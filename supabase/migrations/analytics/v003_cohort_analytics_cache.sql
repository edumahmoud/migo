-- =====================================================
-- Migration 003: Cohort Analytics Cache Table
-- Precomputed cohort-level distributions per teacher.
-- Stores CohortAnalytics JSON + student list for invalidation.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.cohort_analytics_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  cohort_data JSONB NOT NULL,         -- full CohortAnalytics JSON
  student_ids JSONB NOT NULL DEFAULT '[]', -- student UUIDs used in computation
  student_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL     -- 15min TTL
);

-- Lookup by teacher (teacher dashboard loads)
CREATE INDEX IF NOT EXISTS idx_cohort_analytics_teacher
  ON public.cohort_analytics_cache(teacher_id);

-- Lookup by teacher + subject (subject-specific cohort)
CREATE INDEX IF NOT EXISTS idx_cohort_analytics_teacher_subject
  ON public.cohort_analytics_cache(teacher_id, subject_id);

-- TTL expiry scans
CREATE INDEX IF NOT EXISTS idx_cohort_analytics_expires
  ON public.cohort_analytics_cache(expires_at);

-- Add table comments
COMMENT ON TABLE public.cohort_analytics_cache IS 'Precomputed cohort distributions per teacher. 15min TTL. student_ids tracks which students contributed.';
COMMENT ON COLUMN public.cohort_analytics_cache.cohort_data IS 'Full CohortAnalytics JSON: distributions, averages, at-risk count, top performer count';
COMMENT ON COLUMN public.cohort_analytics_cache.student_ids IS 'JSON array of student UUIDs. Used to determine if cohort needs recomputation when a student changes.';
