-- =============================================================
-- v134l_storage_role_aware_quota.sql
-- AttenDo LMS — Fix: storage quota must be role-aware
--
-- Bug:
--   v134k introduced a single `free_quota_mb` column on
--   locked_sections_config. The admin UI lets the admin set
--   two values (student vs teacher), but only the student
--   value is persisted into `free_quota_mb`, and the storage
--   check API returns that single value to BOTH roles.
--   Result: teachers see the student quota (e.g. 100 MB
--   instead of 500 MB).
--
-- Fix:
--   Replace the single `free_quota_mb` with two role-aware
--   columns: `free_quota_mb_student` and `free_quota_mb_teacher`.
--   The storage check API picks the right one based on role.
--   The old `free_quota_mb` column is left in place for
--   backward compatibility (no DROP) but no longer read.
--
-- Data migration:
--   free_quota_mb_student := free_quota_mb (was student value)
--   free_quota_mb_teacher := teacher_monthly_limit (existing)
-- =============================================================

-- 1. Add the two new role-aware columns.
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS free_quota_mb_student INTEGER;

ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS free_quota_mb_teacher INTEGER;

-- 2. Backfill student column from the old single free_quota_mb
--    (which the admin UI was writing with the student value).
UPDATE public.locked_sections_config
SET free_quota_mb_student = COALESCE(free_quota_mb, student_monthly_limit, 100)
WHERE free_quota_mb_student IS NULL;

-- 3. Backfill teacher column from teacher_monthly_limit
--    (the pre-v134k source of truth for teachers).
UPDATE public.locked_sections_config
SET free_quota_mb_teacher = COALESCE(teacher_monthly_limit, 500)
WHERE free_quota_mb_teacher IS NULL;

-- 4. Ensure the files row exists with sensible defaults.
UPDATE public.locked_sections_config
SET free_quota_mb_student = 100,
    free_quota_mb_teacher = 500
WHERE section_key = 'files'
  AND free_quota_mb_student IS NULL
  AND free_quota_mb_teacher IS NULL;

-- 5. Verify.
SELECT section_key,
       free_quota_mb_student,
       free_quota_mb_teacher,
       free_quota_mb AS old_free_quota_mb,
       student_monthly_limit,
       teacher_monthly_limit
FROM public.locked_sections_config
WHERE section_key = 'files';
