-- =============================================================
-- v66_subscription_open_and_payment_methods.sql
-- AttenDo LMS — Course subscription toggle + teacher payment methods.
--
-- Adds:
--   1. subjects.subscription_open (default TRUE) — teacher can close
--      enrollment for a specific course without pausing the course
--      entirely. Agents see the course but cannot register new
--      students into it while it's closed.
--   2. payment_methods table — teacher-owned payment channels
--      (Vodafone Cash, Instapay, bank transfer, etc.) that students
--      see in their account so they know where to send money and
--      which contact to confirm with.
-- =============================================================

-- -------------------------------------------------------------
-- 1. subjects.subscription_open
-- -------------------------------------------------------------
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS subscription_open BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill not needed (DEFAULT TRUE applies to all existing rows on first read).

-- -------------------------------------------------------------
-- 2. payment_methods table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  icon                    TEXT NOT NULL DEFAULT 'wallet'
                          CHECK (icon IN ('wallet','credit_card','banknote','smartphone','building','landmark','repeat')),
  account_identifier      TEXT NOT NULL,
  contact_for_confirmation TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_teacher
  ON public.payment_methods(teacher_id);

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

-- Teacher may manage their own payment methods.
DROP POLICY IF EXISTS pm_teacher_all ON public.payment_methods;
CREATE POLICY pm_teacher_all
  ON public.payment_methods FOR ALL
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- Students may read methods of teachers they are linked to.
DROP POLICY IF EXISTS pm_student_read ON public.payment_methods;
CREATE POLICY pm_student_read
  ON public.payment_methods FOR SELECT
  USING (
    teacher_id IN (
      SELECT teacher_id FROM public.teacher_student_links
      WHERE student_id = auth.uid() AND status = 'approved'
    )
  );

-- Admins may manage all.
DROP POLICY IF EXISTS pm_admin_all ON public.payment_methods;
CREATE POLICY pm_admin_all
  ON public.payment_methods FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -------------------------------------------------------------
-- 3. Realtime publication
-- -------------------------------------------------------------
ALTER PUBLICATION supabase_realtime SET TABLE public.payment_methods;
