-- =====================================================
-- Migration 002: Analytics Snapshots Table
-- Historical snapshots: daily (00:00 UTC) + on_change (grade posted).
-- STRICTLY two types only: 'daily' and 'on_change'.
-- No 'weekly', 'manual', or other types.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('daily', 'on_change')),
  metrics JSONB NOT NULL,            -- full StudentPerformanceMetrics JSON
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary history query: most recent snapshots first for a student/subject
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_student_subject_date
  ON public.analytics_snapshots(student_id, subject_id, created_at DESC);

-- Retention cleanup by snapshot type and date
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type_date
  ON public.analytics_snapshots(snapshot_type, created_at);

-- Query all snapshots for a student (dashboard trend chart)
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_student_date
  ON public.analytics_snapshots(student_id, created_at DESC);

-- Prevent duplicate daily snapshots for the same student/subject/day
-- Only applies to 'daily' type -- on_change can happen multiple times per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_snapshots_daily_unique
  ON public.analytics_snapshots(student_id, subject_id, snapshot_type, date_trunc('day', created_at))
  WHERE snapshot_type = 'daily';

-- Add table comments
COMMENT ON TABLE public.analytics_snapshots IS 'Historical analytics snapshots. daily=00:00 UTC cron, on_change=grade posted trigger. Retention: 365d daily, 90d on_change.';
COMMENT ON COLUMN public.analytics_snapshots.subject_id IS 'NULL = overall student metrics, set = per-subject metrics';
COMMENT ON COLUMN public.analytics_snapshots.snapshot_type IS 'ONLY two types allowed: daily (cron) and on_change (grade trigger). No weekly/manual.';
