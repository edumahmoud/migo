-- =============================================================
-- v134h_files_storage_model.sql
-- AttenDo LMS — Files section: always open + storage upgrade model
--
-- The files section is ALWAYS accessible (never locked). Users get a
-- default storage quota (100MB student / 500MB teacher). When the
-- quota is full, the UI shows an "upgrade storage" message with
-- monthly/yearly subscription options to buy more space.
--
-- This migration:
--   1. Ensures files section is NOT locked (student_locked=false,
--      teacher_locked=false) — it's always accessible.
--   2. Ensures default storage quotas are set.
--   3. The monthly_price/yearly_price on the files section represent
--      the cost of UPGRADING storage (not the cost of accessing it).
-- =============================================================

-- 1. Ensure files section is always open (not locked)
UPDATE public.locked_sections_config
SET student_locked = false,
    teacher_locked = false,
    is_active = true
WHERE section_key = 'files';

-- 2. Ensure default storage quotas
UPDATE public.locked_sections_config
SET student_monthly_limit = COALESCE(student_monthly_limit, 100),
    student_yearly_limit = COALESCE(student_yearly_limit, 100),
    teacher_monthly_limit = COALESCE(teacher_monthly_limit, 500),
    teacher_yearly_limit = COALESCE(teacher_yearly_limit, 500)
WHERE section_key = 'files';

-- 3. Verify
SELECT section_key, section_label,
       student_locked, teacher_locked,
       student_monthly_limit, student_yearly_limit,
       teacher_monthly_limit, teacher_yearly_limit,
       student_monthly_price, student_yearly_price,
       teacher_monthly_price, teacher_yearly_price
FROM public.locked_sections_config
WHERE section_key = 'files';
