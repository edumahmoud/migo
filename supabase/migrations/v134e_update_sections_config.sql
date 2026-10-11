-- =============================================================
-- v134e_update_sections_config.sql
-- AttenDo LMS — Update locked_sections_config with the final 4 sections
--
-- v134e: Revised the lockable sections to only:
--   1. summaries — usage_metric='combined' (ملخصات + اختبارات AI)
--   2. files — usage_metric='storage' (ميجابايت)
--   3. questionBankAI — usage_metric='combined' (توليد أسئلة AI)
--   4. googleForms — usage_metric=null (مشاركة Google Forms)
--
-- Also removes the old sections that are no longer needed.
-- =============================================================

-- 1. Remove old sections that are no longer lockable.
DELETE FROM public.locked_sections_config
WHERE section_key IN (
  'scormLibrary', 'videos', 'assignments', 'tracking',
  'analytics', 'calendar', 'todos'
);

-- 2. Update 'summaries' — keep as combined metric.
UPDATE public.locked_sections_config
SET section_label = 'التلخيصات والاختبارات الذكية',
    usage_metric = 'combined'
WHERE section_key = 'summaries';

-- 3. Update 'files' — change to storage metric (MB).
UPDATE public.locked_sections_config
SET section_label = 'الملفات',
    usage_metric = 'storage',
    -- Default: 100 MB for students, 500 MB for teachers.
    student_max_usage = COALESCE(student_max_usage, 100),
    teacher_max_usage = COALESCE(teacher_max_usage, 500)
WHERE section_key = 'files';

-- 4. Add 'questionBankAI' — AI question generation.
INSERT INTO public.locked_sections_config (section_key, section_label, usage_metric, student_max_usage, teacher_max_usage)
VALUES ('questionBankAI', 'توليد الأسئلة بالذكاء الاصطناعي', 'combined', 10, 50)
ON CONFLICT (section_key) DO UPDATE
SET section_label = EXCLUDED.section_label,
    usage_metric = EXCLUDED.usage_metric,
    student_max_usage = COALESCE(locked_sections_config.student_max_usage, EXCLUDED.student_max_usage),
    teacher_max_usage = COALESCE(locked_sections_config.teacher_max_usage, EXCLUDED.teacher_max_usage);

-- 5. Add 'googleForms' — Google Forms sharing.
INSERT INTO public.locked_sections_config (section_key, section_label, usage_metric)
VALUES ('googleForms', 'مشاركة الأسئلة على Google Forms', NULL)
ON CONFLICT (section_key) DO UPDATE
SET section_label = EXCLUDED.section_label;

-- 6. Verify the final list.
SELECT section_key, section_label, usage_metric,
       student_max_usage, teacher_max_usage,
       student_locked, teacher_locked
FROM public.locked_sections_config
ORDER BY section_key;
