-- =============================================================
-- v78_financial_ledger.sql
-- AttenDo LMS — Phase 8: Financial Ledger
--
-- Creates:
--   1. commission_rates table — server-side source of truth for
--      platform commission percentages. Historical rates are preserved.
--   2. financial_ledger table — immutable financial record per
--      successful payment. Contains snapshotted teacher_id,
--      commission_rate, and all financial amounts.
--   3. Updates the RPC to create a ledger record atomically with
--      payment + enrollment activation.
--   4. Changes CASCADE to RESTRICT on payments.order_id and
--      financial_ledger FKs — paid records cannot be destroyed.
--
-- Historical data safety:
--   - No existing rows are deleted or modified.
--   - Existing payments remain as-is.
--   - The ledger table starts empty — new payments get ledger records.
--   - Historical payments without ledger records are noted in the report.
-- =============================================================

-- -------------------------------------------------------------
-- 1. commission_rates table
--    Server-side source of truth for the platform's commission
--    percentage. Rates are versioned — changing the rate creates
--    a new row, old rows stay for historical calculations.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_percentage NUMERIC(5,2) NOT NULL CHECK (rate_percentage >= 0 AND rate_percentage <= 100),
  -- e.g., 10.00 = 10% platform commission
  is_active       BOOLEAN NOT NULL DEFAULT false,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Only one active rate at a time
  UNIQUE(is_active) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;
-- Service role only (bypasses RLS). No client policies.

-- Insert a default commission rate (10% — can be changed later)
INSERT INTO public.commission_rates (rate_percentage, is_active, effective_from)
VALUES (10.00, true, now())
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------------
-- 2. financial_ledger table
--    Immutable financial record per successful payment.
--    Contains snapshotted teacher_id + commission_rate.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  student_id          UUID NOT NULL,  -- snapshot, no FK (student may be deleted)
  subject_id          UUID NOT NULL,  -- snapshot, no FK (subject may be deleted)
  teacher_id          UUID NOT NULL,  -- SNAPSHOT of subjects.teacher_id at payment time
  gateway_id          UUID,          -- SNAPSHOT of orders.gateway_id
  provider_payment_id TEXT NOT NULL,  -- from payments.provider_payment_id
  currency            TEXT NOT NULL DEFAULT 'EGP',
  gross_amount        NUMERIC(12,2) NOT NULL,    -- total amount paid
  platform_share      NUMERIC(12,2) NOT NULL,    -- platform's commission
  teacher_share       NUMERIC(12,2) NOT NULL,    -- teacher's net share
  gateway_fee         NUMERIC(12,2) NOT NULL DEFAULT 0, -- reserved for future
  net_amount          NUMERIC(12,2) NOT NULL,    -- teacher_share (= gross - platform - gateway_fee)
  commission_rate     NUMERIC(5,2) NOT NULL,    -- SNAPSHOT of the rate at payment time
  status              TEXT NOT NULL DEFAULT 'paid'
                        CHECK (status IN ('pending','paid','failed','refunded','reversed','settled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: one ledger record per payment
  UNIQUE(payment_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_order ON public.financial_ledger(order_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_teacher ON public.financial_ledger(teacher_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_student ON public.financial_ledger(student_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_subject ON public.financial_ledger(subject_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_status ON public.financial_ledger(status);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_gateway ON public.financial_ledger(gateway_id);

ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
-- Service role only.

-- -------------------------------------------------------------
-- 3. Change CASCADE to RESTRICT on payments.order_id
--    This prevents deletion of orders that have payment records.
--    If an order is paid, it cannot be deleted (which would
--    cascade-delete the payment + ledger).
--
--    We drop and recreate the FK with ON DELETE RESTRICT.
--    Historical orders without payments are unaffected.
-- -------------------------------------------------------------
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_order_id_fkey;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;

-- -------------------------------------------------------------
-- 4. Update activate_subscription_after_payment() RPC
--    After INSERT payment + UPDATE order status, the RPC now also:
--    a. Looks up subjects.teacher_id (snapshot)
--    b. Looks up the active commission rate
--    c. Calculates platform_share + teacher_share + net_amount
--    d. INSERTs into financial_ledger (UNIQUE on payment_id = idempotent)
--
--    All financial calculations are Server-Side inside the RPC.
--    No frontend-supplied values are used.
-- =============================================================
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
  v_payment_id UUID;
  v_teacher_id UUID;
  v_gateway_id UUID;
  v_commission_rate NUMERIC(5,2);
  v_gross_amount NUMERIC(12,2);
  v_platform_share NUMERIC(12,2);
  v_teacher_share NUMERIC(12,2);
  v_net_amount NUMERIC(12,2);
  v_gateway_fee NUMERIC(12,2) := 0;
  v_ledger_exists BOOLEAN := false;
BEGIN
  -- Lock the order row to prevent concurrent processing.
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

  -- Insert the payment record (UNIQUE on provider_payment_id = idempotency).
  BEGIN
    INSERT INTO public.payments (order_id, provider_payment_id, amount, currency, status, raw_payload, confirmed_by)
    VALUES (p_order_id, p_provider_payment_id, p_amount, p_currency, p_status, p_raw_payload, p_confirmed_by)
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    -- Payment already recorded — order should already be 'paid'.
    UPDATE public.orders SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
    WHERE id = p_order_id AND status != 'paid';
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END;

  -- Mark order as paid.
  UPDATE public.orders
  SET status = 'paid', paid_at = now(), updated_at = now()
  WHERE id = p_order_id;

  -- UPSERT enrollment with monthly billing period.
  INSERT INTO public.subject_students
    (subject_id, student_id, status, enrollment_method, enrolled_at,
     current_period_start, current_period_end, next_billing_at, monthly_price)
  VALUES
    (v_order.subject_id, v_order.student_id, 'approved', 'self_paid', now(),
     now(), now() + interval '1 month', now() + interval '1 month', p_amount)
  ON CONFLICT (subject_id, student_id) DO UPDATE
  SET
    status = 'approved',
    enrollment_method = 'self_paid',
    enrolled_at = now(),
    monthly_price = p_amount,
    current_period_start = CASE
      WHEN subject_students.current_period_end IS NOT NULL
           AND subject_students.current_period_end > now()
      THEN subject_students.current_period_start
      ELSE now()
    END,
    current_period_end = CASE
      WHEN subject_students.current_period_end IS NOT NULL
           AND subject_students.current_period_end > now()
      THEN subject_students.current_period_end + interval '1 month'
      ELSE now() + interval '1 month'
    END,
    next_billing_at = CASE
      WHEN subject_students.current_period_end IS NOT NULL
           AND subject_students.current_period_end > now()
      THEN subject_students.current_period_end + interval '1 month'
      ELSE now() + interval '1 month'
    END;

  -- ── Financial Ledger Creation (Phase 8) ──
  -- All calculations are Server-Side. No frontend values used.
  -- Snapshotted values: teacher_id, commission_rate, gateway_id.

  -- Check if a ledger record already exists for this payment (idempotency).
  SELECT EXISTS(
    SELECT 1 FROM public.financial_ledger WHERE payment_id = v_payment_id
  ) INTO v_ledger_exists;

  IF NOT v_ledger_exists THEN
    -- Snapshot teacher_id from subjects table at payment time.
    SELECT teacher_id INTO v_teacher_id
    FROM public.subjects WHERE id = v_order.subject_id;

    IF v_teacher_id IS NULL THEN
      -- Subject might have been deleted — use a placeholder.
      -- This is an edge case that shouldn't happen in normal flow.
      v_teacher_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    -- Snapshot gateway_id from the order.
    v_gateway_id := v_order.gateway_id;

    -- Get the active commission rate (snapshot).
    SELECT rate_percentage INTO v_commission_rate
    FROM public.commission_rates
    WHERE is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_commission_rate IS NULL THEN
      v_commission_rate := 0; -- No commission configured → 0%
    END IF;

    -- Financial calculations (all in NUMERIC — no floating-point).
    v_gross_amount := p_amount;
    v_platform_share := ROUND(v_gross_amount * v_commission_rate / 100.0, 2);
    v_gateway_fee := 0; -- Reserved for future gateway fee integration.
    v_teacher_share := v_gross_amount - v_platform_share - v_gateway_fee;
    v_net_amount := v_teacher_share;

    -- Insert the ledger record (UNIQUE on payment_id = idempotent).
    INSERT INTO public.financial_ledger (
      payment_id, order_id, student_id, subject_id, teacher_id,
      gateway_id, provider_payment_id, currency,
      gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
      commission_rate, status
    ) VALUES (
      v_payment_id, p_order_id, v_order.student_id, v_order.subject_id,
      v_teacher_id, v_gateway_id, p_provider_payment_id, p_currency,
      v_gross_amount, v_platform_share, v_teacher_share, v_gateway_fee, v_net_amount,
      v_commission_rate, 'paid'
    )
    ON CONFLICT (payment_id) DO NOTHING;
  END IF;

  -- First successful subscription: activate the student (if pending).
  UPDATE public.users
  SET account_status = 'active', updated_at = now()
  WHERE id = v_order.student_id AND account_status = 'pending';

  UPDATE public.orders
  SET activated_at = now(), updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'student_id', v_order.student_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) TO authenticated, anon, service_role;

-- -------------------------------------------------------------
-- 5. RLS: financial_ledger is read-only for students/teachers
--    (they can view their own records). Only service role can
--    INSERT/UPDATE (via the RPC).
-- -------------------------------------------------------------
DROP POLICY IF EXISTS fl_student_read ON public.financial_ledger;
CREATE POLICY fl_student_read
  ON public.financial_ledger FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS fl_teacher_read ON public.financial_ledger;
CREATE POLICY fl_teacher_read
  ON public.financial_ledger FOR SELECT
  USING (teacher_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies — only service role (bypasses RLS)
-- can write, via the RPC.

-- Done.
-- Verify:
--   \d public.financial_ledger
--   \d public.commission_rates
--   SELECT * FROM public.commission_rates;
