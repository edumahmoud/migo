-- =============================================================
-- v134g_per_plan_limits.sql
-- AttenDo LMS — Per-plan usage limits (monthly vs yearly separate)
--
-- Replaces the single student_max_usage / teacher_max_usage columns
-- with 4 per-plan columns:
--   student_monthly_limit  — limit during a monthly subscription
--   student_yearly_limit   — limit during a yearly subscription
--   teacher_monthly_limit  — limit during a monthly subscription
--   teacher_yearly_limit   — limit during a yearly subscription
--
-- For storage (files): the monthly/yearly distinction doesn't apply
-- (storage is cumulative, not per-period). We keep using the monthly
-- limit as the total quota.
--
-- Migrates existing data: copies old max_usage → both monthly+yearly.
-- =============================================================

-- 1. Add new per-plan limit columns
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS student_monthly_limit INTEGER;
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS student_yearly_limit INTEGER;
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS teacher_monthly_limit INTEGER;
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS teacher_yearly_limit INTEGER;

-- 2. Migrate existing data: copy old max_usage to both new columns
UPDATE public.locked_sections_config
SET student_monthly_limit = COALESCE(student_monthly_limit, student_max_usage),
    student_yearly_limit = COALESCE(student_yearly_limit, student_max_usage),
    teacher_monthly_limit = COALESCE(teacher_monthly_limit, teacher_max_usage),
    teacher_yearly_limit = COALESCE(teacher_yearly_limit, teacher_max_usage);

-- 3. For files: set default quotas (100/500 MB)
UPDATE public.locked_sections_config
SET student_monthly_limit = COALESCE(student_monthly_limit, 100),
    student_yearly_limit = COALESCE(student_yearly_limit, 100),
    teacher_monthly_limit = COALESCE(teacher_monthly_limit, 500),
    teacher_yearly_limit = COALESCE(teacher_yearly_limit, 500)
WHERE section_key = 'files';

-- 4. Drop old columns (data already migrated)
ALTER TABLE public.locked_sections_config
  DROP COLUMN IF EXISTS student_max_usage;
ALTER TABLE public.locked_sections_config
  DROP COLUMN IF EXISTS teacher_max_usage;

-- 5. Verify
SELECT section_key, section_label, usage_metric, teacher_only,
       student_monthly_limit, student_yearly_limit,
       teacher_monthly_limit, teacher_yearly_limit
FROM public.locked_sections_config
ORDER BY section_key;
