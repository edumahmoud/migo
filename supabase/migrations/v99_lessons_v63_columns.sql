-- =====================================================
-- v99: Ensure lessons table has v63 columns (unit_id, order_within_unit, pass_threshold)
-- =====================================================
-- Root cause of "Failed to update lesson" toast when adding/moving a
-- lesson to a unit: the v63 migration adds 3 columns to public.lessons
-- (unit_id, order_within_unit, pass_threshold). If v63 was partially
-- applied (or skipped), these columns are missing → every UPDATE that
-- touches unit_id/order_within_unit fails with a PostgREST 500 error.
--
-- This migration is IDEMPOTENT — uses ADD COLUMN IF NOT EXISTS so it
-- can be re-run safely. If the columns already exist (from v63), this
-- is a no-op. If they're missing, it adds them.
-- =====================================================

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES public.lesson_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_within_unit INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pass_threshold INTEGER;

-- Add an index on (unit_id, order_within_unit) for fast within-unit ordering queries
CREATE INDEX IF NOT EXISTS idx_lessons_unit_id ON public.lessons(unit_id);
CREATE INDEX IF NOT EXISTS idx_lessons_unit_order
  ON public.lessons(unit_id, order_within_unit)
  WHERE unit_id IS NOT NULL;

COMMENT ON COLUMN public.lessons.unit_id IS 'v99 (re-affirms v63): Optional link to a lesson_unit. NULL = standalone lesson.';
COMMENT ON COLUMN public.lessons.order_within_unit IS 'v99 (re-affirms v63): Order within the unit (0-based). Used for sequential display.';
COMMENT ON COLUMN public.lessons.pass_threshold IS 'v99 (re-affirms v63): Optional 0-100 gate score. NULL = no gate.';

-- Done.
