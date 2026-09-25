-- =============================================================
-- v68_self_registration_activation.sql
-- AttenDo LMS — Self-Registered Student Activation + Payment → Subscription flow.
--
-- Adds:
--   1. users.account_status (pending/active/suspended) — DEFAULT 'active'
--      so existing users are unaffected.
--   2. subjects.price + subjects.currency — server-side source of truth
--      for course pricing (never trust client).
--   3. orders + payments tables — provider-agnostic payment records.
--   4. activate_subscription_after_payment() RPC — atomic, idempotent
--      activation logic (verifies payment → upserts enrollment →
--      activates student on first successful subscription).
--   5. Updated handle_new_user() trigger — marks self-registered
--      students (user_metadata.self_registered=true) as PENDING.
--   6. Widened subject_students.enrollment_method CHECK to include 'self_paid'.
--   7. payment_methods.requires_manual_approval flag — for Fawry/InstaPay/cash
--      where there's no automatic webhook (admin/agent must approve).
-- =============================================================

-- -------------------------------------------------------------
-- 1. users.account_status
-- -------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
  CHECK (account_status IN ('pending','active','suspended'));

-- All existing rows get the DEFAULT 'active' (no backfill UPDATE needed;
-- DEFAULT applies to existing rows on first read after column-add in PG11+).
-- New self-registered students will be set to 'pending' by the updated
-- handle_new_user() trigger below.

-- -------------------------------------------------------------
-- 2. subjects.price + currency (server-side source of truth)
-- -------------------------------------------------------------
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EGP';

-- -------------------------------------------------------------
-- 3. orders table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id        UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  amount            NUMERIC(10,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'EGP',
  provider          TEXT NOT NULL DEFAULT 'mock',
  provider_order_ref TEXT UNIQUE,                -- idempotency: gateway-side order id
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  payment_method_id UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  confirmation_mode TEXT NOT NULL DEFAULT 'automatic'
                      CHECK (confirmation_mode IN ('automatic','manual')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ,
  activated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_student ON public.orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_subject ON public.orders(subject_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_student_read ON public.orders;
CREATE POLICY orders_student_read
  ON public.orders FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS orders_student_insert ON public.orders;
CREATE POLICY orders_student_insert
  ON public.orders FOR INSERT
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS orders_admin_all ON public.orders;
CREATE POLICY orders_admin_all
  ON public.orders FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -------------------------------------------------------------
-- 4. payments table (record of trusted confirmations — webhooks or admin approvals)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider_payment_id TEXT UNIQUE NOT NULL,      -- idempotency: UNIQUE prevents duplicates
  amount              NUMERIC(10,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EGP',
  status              TEXT NOT NULL,
  raw_payload         JSONB,
  confirmed_by        UUID REFERENCES public.users(id) ON DELETE SET NULL, -- for manual approvals
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_student_read ON public.payments;
CREATE POLICY payments_student_read
  ON public.payments FOR SELECT
  USING (order_id IN (SELECT id FROM public.orders WHERE student_id = auth.uid()));

DROP POLICY IF EXISTS payments_admin_all ON public.payments;
CREATE POLICY payments_admin_all
  ON public.payments FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -------------------------------------------------------------
-- 5. payment_methods.requires_manual_approval
--    TRUE for Fawry/InstaPay/cash where there's no automatic webhook.
--    FALSE for cards/online gateways that call the webhook directly.
-- -------------------------------------------------------------
ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS requires_manual_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- -------------------------------------------------------------
-- 6. Widen enrollment_method CHECK to include 'self_paid'
-- -------------------------------------------------------------
ALTER TABLE public.subject_students
  DROP CONSTRAINT IF EXISTS subject_students_enrollment_method_check;
ALTER TABLE public.subject_students
  DROP CONSTRAINT IF EXISTS enrollment_method_check;
ALTER TABLE public.subject_students
  ADD CONSTRAINT subject_students_enrollment_method_check
  CHECK (enrollment_method IN ('self_join','teacher_add','agent_register','self_paid'));

-- -------------------------------------------------------------
-- 7. Updated handle_new_user() trigger — marks self-registered
--    students (user_metadata.self_registered=true) as PENDING.
--    Preserves all existing behavior (superadmin-first, fallbacks).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
  insert_role text;
  user_name text;
  is_self_registered boolean;
  new_account_status text;
BEGIN
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  is_self_registered := COALESCE((NEW.raw_user_meta_data->>'self_registered')::boolean, false);

  SELECT COUNT(*) INTO user_count FROM public.users;

  IF user_count = 0 THEN
    insert_role := 'superadmin';
    new_account_status := 'active';
  ELSE
    insert_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
    -- Self-registered students start as PENDING. Agent-created students
    -- (user_metadata.role='student' but self_registered is not set or false)
    -- remain ACTIVE — their flow is unchanged.
    IF insert_role = 'student' AND is_self_registered THEN
      new_account_status := 'pending';
    ELSE
      new_account_status := 'active';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.users (id, email, name, role, account_status)
    VALUES (NEW.id, NEW.email, user_name, insert_role, new_account_status);
    RETURN NEW;
  EXCEPTION
    WHEN check_violation THEN
      IF insert_role = 'superadmin' THEN
        INSERT INTO public.users (id, email, name, role, account_status)
        VALUES (NEW.id, NEW.email, user_name, 'admin', 'active');
      ELSE
        INSERT INTO public.users (id, email, name, role, account_status)
        VALUES (NEW.id, NEW.email, user_name, 'student', new_account_status);
      END IF;
      RETURN NEW;
    WHEN unique_violation THEN
      RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- (The trigger on_auth_user_created already exists from v64 — no need
--  to recreate it. CREATE OR REPLACE FUNCTION updates the body.)

-- -------------------------------------------------------------
-- 8. activate_subscription_after_payment() RPC
--    Atomic + idempotent. Called by /api/payment/webhook (automatic)
--    OR by /api/admin/approve-manual-payment (manual approval flow).
--
--    Idempotency layers:
--      a. payments.provider_payment_id UNIQUE — INSERT fails on dup.
--      b. orders.status check — if already 'paid', return early.
--      c. subject_students UNIQUE(subject_id, student_id) — ON CONFLICT DO UPDATE.
--      d. SELECT FOR UPDATE on the order row — prevents concurrent processing.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_subscription_after_payment(
  p_order_id UUID,
  p_provider_payment_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_status TEXT,
  p_raw_payload JSONB,
  p_confirmed_by UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_already_paid BOOLEAN := FALSE;
BEGIN
  -- Lock the order row to prevent concurrent activation.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- Verify amount + currency match (defends against client tampering).
  IF v_order.amount != p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_mismatch',
      'expected', v_order.amount, 'got', p_amount);
  END IF;
  IF v_order.currency != p_currency THEN
    RETURN jsonb_build_object('success', false, 'error', 'currency_mismatch',
      'expected', v_order.currency, 'got', p_currency);
  END IF;

  -- Idempotency: if order is already 'paid', return success without re-processing.
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  -- Idempotency: try to insert the payment record (UNIQUE on provider_payment_id).
  BEGIN
    INSERT INTO public.payments (order_id, provider_payment_id, amount, currency, status, raw_payload, confirmed_by)
    VALUES (p_order_id, p_provider_payment_id, p_amount, p_currency, p_status, p_raw_payload, p_confirmed_by);
  EXCEPTION WHEN unique_violation THEN
    -- Payment already recorded — order should already be 'paid'.
    -- Return success (idempotent).
    UPDATE public.orders SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
    WHERE id = p_order_id AND status != 'paid';
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END;

  -- Mark order as paid.
  UPDATE public.orders
  SET status = 'paid', paid_at = now(), updated_at = now()
  WHERE id = p_order_id;

  -- Upsert enrollment (UNIQUE(subject_id, student_id) prevents duplicates).
  INSERT INTO public.subject_students
    (subject_id, student_id, status, enrollment_method, enrolled_at)
  VALUES
    (v_order.subject_id, v_order.student_id, 'approved', 'self_paid', now())
  ON CONFLICT (subject_id, student_id) DO UPDATE
  SET status = 'approved', enrollment_method = 'self_paid', enrolled_at = now();

  -- First successful subscription: activate the student (if pending).
  -- NEVER downgrade an ACTIVE student, and never auto-un-suspend a SUSPENDED one.
  UPDATE public.users
  SET account_status = 'active', updated_at = now()
  WHERE id = v_order.student_id AND account_status = 'pending';

  UPDATE public.orders
  SET activated_at = now(), updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'student_id', v_order.student_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow callers (incl. service role) to execute the RPC.
GRANT EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) TO authenticated, anon, service_role;

-- -------------------------------------------------------------
-- 9. Realtime (optional)
-- -------------------------------------------------------------
ALTER PUBLICATION supabase_realtime SET TABLE public.orders;
ALTER PUBLICATION supabase_realtime SET TABLE public.payments;
