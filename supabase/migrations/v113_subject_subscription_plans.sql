-- =====================================================
-- v113: Subject subscription plans (monthly/term/yearly)
-- =====================================================
-- Adds a new table: subject_subscription_plans
-- Each subject can have multiple subscription plans:
--   - monthly (per month)
--   - term (per term/semester)
--   - yearly (per year)
--   - custom (teacher-defined)
--
-- The teacher can:
--   - Set the price for each plan
--   - Activate/deactivate plans
--   - Only active plans appear during student checkout
--
-- The existing subjects.price stays as the DEFAULT (monthly) price
-- for backward compatibility. The subject_subscription_plans table
-- extends this with additional period types.
--
-- The existing subject_students.monthly_price + current_period_*
-- columns continue to work — the chosen plan's price + duration
-- is snapshotted there at checkout time.
--
-- NO existing data is modified.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.subject_subscription_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  period_type   TEXT NOT NULL CHECK (period_type IN ('monthly', 'term', 'yearly', 'custom')),
  period_label  TEXT NOT NULL DEFAULT '',         -- custom label (e.g., "ترم أول 2025")
  duration_days INTEGER NOT NULL DEFAULT 30,      -- duration in days (30=monthly, 120=term, 365=yearly)
  price         NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'EGP',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(subject_id, period_type)
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_subject
  ON public.subject_subscription_plans(subject_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active
  ON public.subject_subscription_plans(subject_id)
  WHERE is_active = true;

ALTER TABLE public.subject_subscription_plans ENABLE ROW LEVEL SECURITY;

-- Teachers can CRUD their own subject's plans
DROP POLICY IF EXISTS "Teachers can manage subscription plans" ON public.subject_subscription_plans;
CREATE POLICY "Teachers can manage subscription plans"
  ON public.subject_subscription_plans FOR ALL
  USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  )
  WITH CHECK (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

-- Students can view active plans for subjects they're enrolled in or can subscribe to
DROP POLICY IF EXISTS "Students can view active subscription plans" ON public.subject_subscription_plans;
CREATE POLICY "Students can view active subscription plans"
  ON public.subject_subscription_plans FOR SELECT
  USING (is_active = true);

-- Admins can manage all plans
DROP POLICY IF EXISTS "Admins can manage all subscription plans" ON public.subject_subscription_plans;
CREATE POLICY "Admins can manage all subscription plans"
  ON public.subject_subscription_plans FOR ALL
  USING (public.is_admin());

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subject_subscription_plans TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Enable realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_subscription_plans;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

COMMENT ON TABLE public.subject_subscription_plans IS
  'Per-subject subscription plans. Each subject can have multiple plans (monthly, term, yearly, custom) with different prices and durations. Only active plans appear during student checkout. The chosen plan price + duration is snapshotted into subject_students at checkout.';

-- Done.
-- Verify:
--   \d public.subject_subscription_plans
--   SELECT * FROM public.subject_subscription_plans;
