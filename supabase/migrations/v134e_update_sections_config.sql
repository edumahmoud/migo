-- =============================================================
-- v134e_update_sections_config.sql (FINAL)
-- AttenDo LMS — Update locked_sections_config with the final 4 sections
--
-- v134e: Revised the lockable sections to only:
--   1. summaries — usage_metric='combined', NO default limit (NULL = غير محدود)
--   2. files — usage_metric='storage', default 100MB student / 500MB teacher
--   3. questionBankAI — usage_metric='combined', NO default limit (NULL = غير محدود)
--   4. googleForms — usage_metric=null (مشاركة Google Forms, no limit)
--
-- AI features (summaries, quizzes, question bank AI) have NO default
-- limit. Only files have a default storage quota. The admin can set
-- custom limits later via the paid-services config UI.
-- =============================================================

-- 1. Remove old sections that are no longer lockable.
DELETE FROM public.locked_sections_config
WHERE section_key IN (
  'scormLibrary', 'videos', 'assignments', 'tracking',
  'analytics', 'calendar', 'todos'
);

-- 2. Update 'summaries' — combined metric, NO default limit.
UPDATE public.locked_sections_config
SET section_label = 'التلخيصات والاختبارات الذكية',
    usage_metric = 'combined',
    student_max_usage = NULL,
    teacher_max_usage = NULL
WHERE section_key = 'summaries';

-- 3. Update 'files' — storage metric with default quota.
UPDATE public.locked_sections_config
SET section_label = 'الملفات',
    usage_metric = 'storage',
    student_max_usage = COALESCE(student_max_usage, 100),
    teacher_max_usage = COALESCE(teacher_max_usage, 500)
WHERE section_key = 'files';

-- 4. Add 'questionBankAI' — AI question generation, NO default limit.
INSERT INTO public.locked_sections_config (section_key, section_label, usage_metric, student_max_usage, teacher_max_usage)
VALUES ('questionBankAI', 'توليد الأسئلة بالذكاء الاصطناعي', 'combined', NULL, NULL)
ON CONFLICT (section_key) DO UPDATE
SET section_label = EXCLUDED.section_label,
    usage_metric = EXCLUDED.usage_metric,
    student_max_usage = NULL,
    teacher_max_usage = NULL;

-- 5. Add 'googleForms' — Google Forms sharing, no metric.
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
