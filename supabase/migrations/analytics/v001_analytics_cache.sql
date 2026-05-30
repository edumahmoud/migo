-- =====================================================
-- Migration 001: Analytics Cache Table
-- Stores precomputed student/subject metrics with TTL.
-- Core of the cache-aside pattern in the analytics service.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.analytics_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL,
  cache_type TEXT NOT NULL CHECK (cache_type IN ('student', 'subject')),
  entity_id UUID NOT NULL,           -- student_id for student type
  teacher_id UUID,                   -- denormalized for invalidation queries
  subject_id UUID,                   -- NULL for overall, set for per-subject
  metrics JSONB NOT NULL,            -- full StudentPerformanceMetrics JSON
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,   -- TTL expiry timestamp
  hit_count INTEGER NOT NULL DEFAULT 0
);

-- Unique constraint: one cache entry per key
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_cache_key
  ON public.analytics_cache(cache_key);

-- TTL expiry scans (cleanup job uses this)
CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires
  ON public.analytics_cache(expires_at);

-- Find all cache entries for a specific student/entity
CREATE INDEX IF NOT EXISTS idx_analytics_cache_type_entity
  ON public.analytics_cache(cache_type, entity_id);

-- Invalidate all cache for a teacher's cohort
CREATE INDEX IF NOT EXISTS idx_analytics_cache_teacher
  ON public.analytics_cache(teacher_id) WHERE teacher_id IS NOT NULL;

-- Find cache entries by subject (for subject-level invalidation)
CREATE INDEX IF NOT EXISTS idx_analytics_cache_subject
  ON public.analytics_cache(subject_id) WHERE subject_id IS NOT NULL;

-- Add table comment
COMMENT ON TABLE public.analytics_cache IS 'Precomputed analytics metrics cache. TTL-based expiry with DB trigger invalidation.';
COMMENT ON COLUMN public.analytics_cache.cache_key IS 'Encoded key: student:{id}, student:{id}:subject:{id}, etc.';
COMMENT ON COLUMN public.analytics_cache.metrics IS 'Full StudentPerformanceMetrics JSON object';
COMMENT ON COLUMN public.analytics_cache.expires_at IS 'TTL expiry. 30min for student, 15min for cohort. Fallback if triggers fail.';
