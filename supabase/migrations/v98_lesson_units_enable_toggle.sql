-- =====================================================
-- v98: Lesson unit enable/disable toggle
-- =====================================================
-- Adds `is_enabled` to `lesson_units`.
--
-- SEMANTICS:
--   is_published (existing, default true):
--     When false → unit is INVISIBLE to students (only teacher sees it).
--     Used for draft units not ready for student view.
--
--   is_enabled (NEW, default true):
--     When false → unit is VISIBLE to students but LOCKED — students
--     see the unit (and its lessons) but cannot OPEN them.
--     Used when the teacher wants to temporarily lock a unit
--     (e.g., exam week, mid-term review) without hiding it.
--
-- Both flags default to true so existing units remain fully accessible.
-- =====================================================

ALTER TABLE public.lesson_units
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.lesson_units.is_enabled IS
  'v98: When false, the unit is visible to students but LOCKED — students see the unit + its lessons but cannot OPEN them. Used to temporarily lock a unit without hiding it. Defaults to true (enabled).';

-- Done.
