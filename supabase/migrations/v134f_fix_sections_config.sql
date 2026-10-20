-- =============================================================
-- v134f_fix_sections_config.sql
-- AttenDo LMS — Fix sections config: teacher_only flag + clarify
--
-- Fixes:
--   1. Add 'teacher_only' column — when true, student fields are
--      hidden in the admin UI + the section is never shown as locked
--      to students.
--   2. Mark questionBankAI + googleForms as teacher_only = true.
--   3. Ensure files storage quota is always enforced (even without lock).
--   4. Clean up: remove student pricing/limits from teacher-only sections.
-- =============================================================

-- 1. Add teacher_only column
ALTER TABLE public.locked_sections_config
  ADD COLUMN IF NOT EXISTS teacher_only BOOLEAN NOT NULL DEFAULT false;

-- 2. Mark teacher-only sections
UPDATE public.locked_sections_config
SET teacher_only = true,
    student_locked = false,
    student_monthly_price = 0,
    student_yearly_price = 0,
    student_max_usage = NULL
WHERE section_key IN ('questionBankAI', 'googleForms');

-- 3. Ensure files has default storage quota (always enforced)
UPDATE public.locked_sections_config
SET student_max_usage = COALESCE(student_max_usage, 100),
    teacher_max_usage = COALESCE(teacher_max_usage, 500)
WHERE section_key = 'files';

-- 4. Verify
SELECT section_key, section_label, teacher_only,
       student_locked, teacher_locked,
       student_max_usage, teacher_max_usage,
       usage_metric
FROM public.locked_sections_config
ORDER BY section_key;
