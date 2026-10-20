-- =============================================================
-- v134k_storage_separation.sql
-- AttenDo LMS — Separate free storage from commercial storage
--
-- Model:
--   1. FREE STORAGE (default_quota_mb in locked_sections_config)
--      - Controlled by admin via "إعدادات القفل" → الملفات
--      - Default: 100MB student / 500MB teacher
--      - Always active, always free
--
--   2. COMMERCIAL STORAGE (storage_plans table)
--      - Multiple plans like Google Drive (50GB, 200GB, 2TB...)
--      - Each plan: name + size_mb + price
--      - User buys a plan → admin approves → user_storage_upgrades
--      - The purchased size is ADDED on top of the free quota
--      - Total = free_quota + purchased_size
--
-- This migration:
--   - Renames student_monthly_limit → free_quota_mb (on files row)
--   - Adds 'free_quota_mb' column to locked_sections_config for clarity
--   - Keeps storage_plans as the commercial plans table
-- =============================================================

-- 1. Add free_quota_mb column (the free tier, always active)
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS free_quota_mb INTEGER;

-- 2. Copy the current student_monthly_limit → free_quota_mb (for files)
UPDATE public.locked_sections_config
SET free_quota_mb = student_monthly_limit
WHERE section_key = 'files' AND free_quota_mb IS NULL;

-- 3. Ensure defaults
UPDATE public.locked_sections_config
SET free_quota_mb = 100
WHERE section_key = 'files' AND free_quota_mb IS NULL;

-- 4. Verify
SELECT section_key, free_quota_mb,
       student_monthly_limit, student_yearly_limit,
       teacher_monthly_limit, teacher_yearly_limit
FROM public.locked_sections_config
WHERE section_key = 'files';
