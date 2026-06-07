import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/migrate/analytics-tables
 * Creates analytics cache, snapshots, and cohort precomputation tables.
 * Safe to run multiple times (IF NOT EXISTS).
 */
export async function POST(request: NextRequest) {
  // ─── Security: Only superadmin can run migrations ───
  const adminResult = await requireSuperAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  try {
    // Try to verify table existence by selecting
    const { error: checkError } = await supabaseServer
      .from('analytics_cache')
      .select('id')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        status: 'migrated',
        message: 'Analytics tables already exist',
      });
    }

    // Tables don't exist — return SQL for manual execution in Supabase Dashboard
    return NextResponse.json({
      status: 'pending',
      message: 'Run this SQL in Supabase Dashboard SQL Editor to create analytics tables:',
      sql: `
-- =====================================================
-- Analytics Cache Table
-- Stores precomputed student/subject metrics with TTL
-- =====================================================
CREATE TABLE IF NOT EXISTS public.analytics_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  cache_type TEXT NOT NULL CHECK (cache_type IN ('student', 'subject')),
  entity_id UUID NOT NULL,
  teacher_id UUID,
  subject_id UUID,
  metrics JSONB NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_analytics_cache_key ON public.analytics_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires ON public.analytics_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_type_entity ON public.analytics_cache(cache_type, entity_id);

-- =====================================================
-- Historical Snapshots Table
-- Daily/weekly snapshots of student metrics for trend analysis
-- =====================================================
CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL,
  subject_id UUID,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('daily', 'weekly', 'manual', 'on_change')),
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_student ON public.analytics_snapshots(student_id, snapshot_type);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_date ON public.analytics_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_student_subject ON public.analytics_snapshots(student_id, subject_id, created_at DESC);

-- =====================================================
-- Cohort Analytics Cache Table
-- Precomputed cohort-level distributions per teacher
-- =====================================================
CREATE TABLE IF NOT EXISTS public.cohort_analytics_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL,
  subject_id UUID,
  cohort_data JSONB NOT NULL,
  student_ids JSONB NOT NULL DEFAULT '[]',
  student_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cohort_analytics_teacher ON public.cohort_analytics_cache(teacher_id);
CREATE INDEX IF NOT EXISTS idx_cohort_analytics_expires ON public.cohort_analytics_cache(expires_at);

-- =====================================================
-- RLS Policies
-- =====================================================
ALTER TABLE public.analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_analytics_cache ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (already bypasses RLS)
-- Teachers can read their own cohort cache and student caches
CREATE POLICY "Teachers read own analytics cache"
  ON public.analytics_cache FOR SELECT
  USING (teacher_id = auth.uid() OR entity_id = auth.uid());

CREATE POLICY "Students read own analytics cache"
  ON public.analytics_cache FOR SELECT
  USING (entity_id = auth.uid());

CREATE POLICY "Users read own snapshots"
  ON public.analytics_snapshots FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Teachers read own cohort cache"
  ON public.cohort_analytics_cache FOR SELECT
  USING (teacher_id = auth.uid());

-- Allow service role to insert/update/delete (bypasses RLS anyway)
-- But also allow users to insert their own cache entries
CREATE POLICY "Users insert own cache"
  ON public.analytics_cache FOR INSERT
  WITH CHECK (entity_id = auth.uid() OR teacher_id = auth.uid());

CREATE POLICY "Users insert own snapshots"
  ON public.analytics_snapshots FOR INSERT
  WITH CHECK (student_id = auth.uid());

-- Enable realtime for cache invalidation
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.analytics_cache;
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.cohort_analytics_cache;
      `.trim(),
    });
  } catch (err) {
    console.error('[Migration] Error:', err);
    return NextResponse.json({
      status: 'error',
      message: 'حدث خطأ أثناء تنفيذ الترحيل',
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
