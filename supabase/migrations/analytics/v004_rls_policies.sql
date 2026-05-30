-- =====================================================
-- Migration 004: Row Level Security for Analytics Tables
-- Service role bypasses RLS (used by analytics-service.ts).
-- Users can only read their own data.
-- =====================================================

-- Enable RLS on all 3 tables
ALTER TABLE public.analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_analytics_cache ENABLE ROW LEVEL SECURITY;

-- ===== analytics_cache SELECT policies =====

-- Students can read their own cache entries (entity_id = their user id)
CREATE POLICY "Students read own analytics cache"
  ON public.analytics_cache FOR SELECT
  USING (entity_id = auth.uid());

-- Teachers can read cache entries they own (teacher_id = their user id)
CREATE POLICY "Teachers read own analytics cache"
  ON public.analytics_cache FOR SELECT
  USING (teacher_id = auth.uid());

-- ===== analytics_cache INSERT/UPDATE/DELETE =====
-- Only the service role (analytics-service) writes to this table.
-- Service role bypasses RLS, so no INSERT/UPDATE/DELETE policies needed.
-- Explicitly DENY user writes by not creating write policies.

-- ===== analytics_snapshots SELECT policies =====

-- Students can read their own snapshots
CREATE POLICY "Students read own snapshots"
  ON public.analytics_snapshots FOR SELECT
  USING (student_id = auth.uid());

-- Teachers can read snapshots of students linked to them
CREATE POLICY "Teachers read linked student snapshots"
  ON public.analytics_snapshots FOR SELECT
  USING (
    student_id IN (
      SELECT student_id FROM public.teacher_student_links
      WHERE teacher_id = auth.uid() AND status = 'approved'
    )
  );

-- Teachers can read snapshots of students in their subjects
CREATE POLICY "Teachers read subject student snapshots"
  ON public.analytics_snapshots FOR SELECT
  USING (
    subject_id IN (
      SELECT public.get_teacher_subject_ids(auth.uid())
    )
  );

-- ===== analytics_snapshots INSERT/UPDATE/DELETE =====
-- Only service role writes. No user-facing write policies.

-- ===== cohort_analytics_cache SELECT policies =====

-- Teachers can read their own cohort cache
CREATE POLICY "Teachers read own cohort cache"
  ON public.cohort_analytics_cache FOR SELECT
  USING (teacher_id = auth.uid());

-- ===== cohort_analytics_cache INSERT/UPDATE/DELETE =====
-- Only service role writes. No user-facing write policies.
