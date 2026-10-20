-- =============================================================
-- v134d_fix_paid_sections.sql
-- AttenDo LMS — Fix RLS policies + seed data for paid sections
--
-- Fixes:
--   1. RLS SELECT policy on section_activation_requests referenced
--      'student_id' which doesn't exist — should be 'user_id'.
--      This caused the GET /api/sections/activation-request to fail
--      (returning empty results), and may have caused INSERT failures
--      when the client used the anon key.
--   2. Re-seed the locked_sections_config table (in case the rows
--      were deleted by the v133 data-destruct feature).
-- =============================================================

-- 1. Fix RLS policies on section_activation_requests
DROP POLICY IF EXISTS "Users read own section requests" ON public.section_activation_requests;
CREATE POLICY "Users read own section requests"
  ON public.section_activation_requests FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users create own section requests" ON public.section_activation_requests;
CREATE POLICY "Users create own section requests"
  ON public.section_activation_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins update section requests" ON public.section_activation_requests;
CREATE POLICY "Admins update section requests"
  ON public.section_activation_requests FOR UPDATE
  USING (public.is_admin());

-- 2. Re-seed locked_sections_config (in case rows were deleted)
INSERT INTO public.locked_sections_config (section_key, section_label, usage_metric) VALUES
  ('summaries',     'التلخيصات',     'combined'),
  ('questionBank',  'بنك الأسئلة',   NULL),
  ('scormLibrary',  'مكتبة SCORM',   NULL),
  ('videos',        'الفيديوهات',    NULL),
  ('files',         'الملفات',       NULL),
  ('assignments',   'الواجبات',      NULL),
  ('tracking',      'تتبع الأداء',   NULL),
  ('analytics',     'التحليلات',     NULL),
  ('calendar',      'التقويم',       NULL),
  ('todos',         'المهام',        NULL)
ON CONFLICT (section_key) DO NOTHING;

-- 3. Verify
SELECT count(*) AS total_config_rows FROM public.locked_sections_config;
