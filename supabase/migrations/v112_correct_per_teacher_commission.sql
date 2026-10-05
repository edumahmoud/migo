-- =====================================================
-- v112: Corrective migration for per-teacher commission
-- =====================================================
-- GOAL: re-assert (defensively, idempotently) the intended
-- final architecture for the per-teacher commission feature.
--
--   1. users.commission_rate is the ONLY per-teacher commission
--      column. (commission_percentage is NOT introduced.)
--   2. activate_subscription_after_payment() uses the v88/v89
--      fees-on-top model — the money split comes from the
--      order_fees snapshot (platform_commission + tax + other
--      fees). The legacy commission_rate column on
--      financial_ledger is kept as a display-only snapshot.
--   3. EXECUTE on the RPC is restricted to service_role only
--      (v94 security posture).
--
-- This migration is FULLY IDEMPOTENT and DEFENSIVE:
--   - ADD COLUMN IF NOT EXISTS users.commission_rate
--     (no-op if the column already exists from your applied v111).
--   - CREATE OR REPLACE FUNCTION with the v88/v89/v94 body
--     (no behavioral change if the body is already correct;
--      restores it if the broken committed v111 was re-run).
--   - REVOKE / GRANT EXECUTE (re-asserts v94 grants).
--
-- This migration does NOT:
--   - Introduce users.commission_percentage (forbidden).
--   - Drop or rename any existing column data.
--   - Modify any existing financial_ledger row.
--   - Recalculate any commission_rate snapshot.
--   - Touch any order_fees snapshot.
--   - Change unrelated schema or functions.
--
-- HISTORICAL DATA SAFETY (absolute requirement):
--   Existing rows in users, orders, order_fees, payments, and
--   financial_ledger are NEVER modified by this migration.
-- =====================================================

-- ───────────────────────────────────────────────────────
-- 1. Ensure users.commission_rate exists with correct constraint
--    (idempotent — no-op if already added by your applied v111)
-- ───────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2)
  CHECK (commission_rate IS NULL
         OR (commission_rate >= 0 AND commission_rate <= 100));

COMMENT ON COLUMN public.users.commission_rate IS
  'Per-teacher platform commission percentage (0.00-100.00). NULL = use the platform default (active fee_catalog platform_commission fee, falling back to the active commission_rates row). Applied only to orders created AFTER the value is set — historical transactions keep their snapshotted rates.';

CREATE INDEX IF NOT EXISTS idx_users_commission_rate
  ON public.users(commission_rate)
  WHERE commission_rate IS NOT NULL;

-- ───────────────────────────────────────────────────────
-- 2. Re-assert the correct v88/v89 fees-on-top RPC body
--    (defensive — no behavioral change if already correct)
--
--    Money split source: order_fees snapshot (taken at checkout).
--    commission_rate snapshot: per-teacher rate, falling back to
--    the global commission_rates row, then 0.
--
--    NOTE: this body is functionally equivalent to the v88/v89/v94
--    RPC you already deployed. Re-declaring it via CREATE OR
--    REPLACE is safe and idempotent — it has no effect on data,
--    only on the function definition for future invocations.
-- ───────────────────────────────────────────────────────
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
  v_already_paid BOOLEAN := false;
  v_already_processed BOOLEAN := false;
  -- v88 fee breakdown
  v_subscription_total       NUMERIC(12,2);
  v_platform_commission_amt NUMERIC(12,2) := 0;
  v_tax_amount              NUMERIC(12,2) := 0;
  v_other_fees_amount       NUMERIC(12,2) := 0;
  v_fees_breakdown          JSONB := '[]'::jsonb;
  v_fee_row                 RECORD;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- v88 amount validation: prefer grand_total (= base + fees), fall
  -- back to orders.amount for legacy pre-v88 orders.
  IF v_order.grand_total IS NOT NULL THEN
    IF v_order.grand_total != p_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'amount_mismatch',
        'expected', v_order.grand_total, 'got', p_amount,
        'note', 'expected grand_total (= base_amount + fees_total)');
    END IF;
  ELSE
    IF v_order.amount != p_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'amount_mismatch',
        'expected', v_order.amount, 'got', p_amount,
        'note', 'legacy order (pre-v88) — expected orders.amount');
    END IF;
  END IF;

  IF v_order.currency != p_currency THEN
    RETURN jsonb_build_object('success', false, 'error', 'currency_mismatch',
      'expected', v_order.currency, 'got', p_currency);
  END IF;

  IF v_order.status = 'paid' THEN
    v_already_paid := true;
  END IF;

  BEGIN
    INSERT INTO public.payments (order_id, provider_payment_id, amount, currency, status, raw_payload, confirmed_by)
    VALUES (p_order_id, p_provider_payment_id, p_amount, p_currency, p_status, p_raw_payload, p_confirmed_by)
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_payment_id FROM public.payments WHERE provider_payment_id = p_provider_payment_id;
    v_already_processed := true;
  END;

  UPDATE public.orders
  SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
  WHERE id = p_order_id AND status != 'paid';

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

  SELECT EXISTS(
    SELECT 1 FROM public.financial_ledger WHERE payment_id = v_payment_id
  ) INTO v_ledger_exists;

  IF NOT v_ledger_exists AND v_payment_id IS NOT NULL THEN
    -- Snapshot teacher_id from subjects table at payment time.
    SELECT teacher_id INTO v_teacher_id
    FROM public.subjects WHERE id = v_order.subject_id;

    IF v_teacher_id IS NULL THEN
      v_teacher_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    v_gateway_id := v_order.gateway_id;

    -- v88 — Read fee breakdown from order_fees snapshot (taken at checkout)
    v_subscription_total := COALESCE(v_order.base_amount, v_order.amount);

    FOR v_fee_row IN
      SELECT code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount
      FROM public.order_fees WHERE order_id = p_order_id
      ORDER BY sort_order
    LOOP
      v_fees_breakdown := v_fees_breakdown || jsonb_build_object(
        'code', v_fee_row.code,
        'name_ar', v_fee_row.name_ar,
        'name_en', v_fee_row.name_en,
        'fee_kind', v_fee_row.fee_kind,
        'value', v_fee_row.value,
        'base_amount', v_fee_row.base_amount,
        'calculated_amount', v_fee_row.calculated_amount
      );
      IF v_fee_row.code = 'platform_commission' THEN
        v_platform_commission_amt := v_platform_commission_amt + v_fee_row.calculated_amount;
      ELSIF v_fee_row.code LIKE 'tax%' THEN
        v_tax_amount := v_tax_amount + v_fee_row.calculated_amount;
      ELSE
        v_other_fees_amount := v_other_fees_amount + v_fee_row.calculated_amount;
      END IF;
    END LOOP;

    -- v88 financial calculations:
    --   gross_amount       = grand_total = what Paymob charged the student
    --   platform_share     = commission + tax + other fees (all stay with platform)
    --   teacher_share      = subscription_total - platform_commission
    --   net_amount         = teacher_share
    v_gross_amount := p_amount;
    v_platform_share := v_platform_commission_amt + v_tax_amount + v_other_fees_amount;
    v_teacher_share := v_subscription_total - v_platform_commission_amt;
    v_net_amount := v_teacher_share;

    -- v111/v112 — Snapshot commission_rate for legacy display.
    -- Resolution order:
    --   1. users.commission_rate (per-teacher override) — set by admin
    --      in Teacher Accounts; applies from the moment it's set.
    --   2. The global active commission_rates row (legacy default).
    --   3. 0.
    -- Historical ledger rows keep their original snapshot — this only
    -- affects NEW transactions.
    SELECT u.commission_rate INTO v_commission_rate
    FROM public.users u WHERE u.id = v_teacher_id;

    IF v_commission_rate IS NULL THEN
      SELECT rate_percentage INTO v_commission_rate
      FROM public.commission_rates WHERE is_active = true
      ORDER BY effective_from DESC LIMIT 1;
    END IF;

    IF v_commission_rate IS NULL THEN
      v_commission_rate := 0;
    END IF;

    INSERT INTO public.financial_ledger (
      payment_id, order_id, student_id, subject_id, teacher_id,
      gateway_id, provider_payment_id, currency,
      gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
      commission_rate, status,
      subscription_total, tax_amount, other_fees_amount, fees_breakdown
    ) VALUES (
      v_payment_id, p_order_id, v_order.student_id, v_order.subject_id,
      v_teacher_id, v_gateway_id, p_provider_payment_id, p_currency,
      v_gross_amount, v_platform_share, v_teacher_share, v_gateway_fee, v_net_amount,
      v_commission_rate, 'paid',
      v_subscription_total, v_tax_amount, v_other_fees_amount, v_fees_breakdown
    )
    ON CONFLICT (payment_id) DO NOTHING;
  END IF;

  UPDATE public.users
  SET account_status = 'active', updated_at = now()
  WHERE id = v_order.student_id AND account_status = 'pending';

  UPDATE public.orders
  SET activated_at = now(), updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'student_id', v_order.student_id,
    'already_paid', v_already_paid,
    'already_processed', v_already_processed,
    'ledger_reconciled', (NOT v_ledger_exists) AND (v_payment_id IS NOT NULL),
    'v88_breakdown', jsonb_build_object(
      'subscription_total', v_subscription_total,
      'platform_commission', v_platform_commission_amt,
      'tax_amount', v_tax_amount,
      'other_fees_amount', v_other_fees_amount,
      'gross_amount', v_gross_amount,
      'platform_share', v_platform_share,
      'teacher_share', v_teacher_share
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- v94 security posture — EXECUTE for service_role ONLY.
-- (Re-asserting REVOKE + GRANT is idempotent.)
REVOKE EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) TO service_role;

COMMENT ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) IS
  'v112: re-asserts the v88/v89/v94 fees-on-top + per-teacher commission model. Money split comes from the order_fees snapshot (platform_commission + tax + other fees). commission_rate is a legacy display-only snapshot resolved per-teacher (users.commission_rate) → global commission_rates → 0. EXECUTE restricted to service_role (v94). Idempotent — no historical data is modified.';

-- Done.
-- Verify after applying (manual):
--   \d public.users                              -- should show commission_rate (NO commission_percentage)
--   SELECT id, name, role, commission_rate FROM public.users WHERE role = 'teacher';
--   SELECT proacl FROM pg_proc WHERE proname = 'activate_subscription_after_payment';
--   -- proacl should show service_role=X/X; anon and authenticated should NOT appear.
--   SELECT COUNT(*) FROM information_schema.columns
--     WHERE table_name = 'users' AND column_name = 'commission_percentage';
--   -- should return 0.
