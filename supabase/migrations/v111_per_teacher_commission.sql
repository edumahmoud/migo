-- =====================================================
-- v111: Per-teacher platform commission percentage
-- =====================================================
-- GOAL: support a DYNAMIC commission rate per teacher, configured
-- independently for each teacher. Previously the platform had ONE
-- global active row in commission_rates that applied to every
-- teacher. Now each teacher can have their own rate; teachers
-- without an explicit per-teacher rate fall back to the global
-- commission_rates row (existing behavior preserved).
--
-- Historical safety (CRITICAL):
--   - financial_ledger.commission_rate is a SNAPSHOT taken at
--     payment time. Changing users.commission_percentage today
--     does NOT recalculate or modify any existing ledger row.
--   - The activate_subscription_after_payment() RPC is updated
--     to look up the per-teacher rate FIRST, then fall back to
--     the global rate. The snapshot logic is unchanged.
--   - No existing rows in users, payments, financial_ledger, or
--     orders are modified by this migration (only ALTER TABLE
--     ADD COLUMN + CREATE OR REPLACE FUNCTION).
-- =====================================================

-- ───────────────────────────────────────────────────────
-- 1. Add users.commission_percentage column
-- ───────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC(5,2)
  -- NULL = use the global active commission_rates row (existing behavior).
  -- 0-100 = explicit per-teacher override.
  CHECK (commission_percentage IS NULL
         OR (commission_percentage >= 0 AND commission_percentage <= 100));

COMMENT ON COLUMN public.users.commission_percentage IS
  'Per-teacher platform commission percentage (0.00-100.00). When NULL, the global active commission_rates row is used (existing behavior). When set, this rate overrides the global rate for THIS teacher only. Changes apply ONLY to NEW transactions — historical financial_ledger rows keep their snapshot commission_rate and are NEVER recalculated.';

-- Index for the admin teachers list query (filters by role='teacher'
-- and may sort by commission_percentage for quick scanning).
CREATE INDEX IF NOT EXISTS idx_users_commission_percentage
  ON public.users(commission_percentage)
  WHERE commission_percentage IS NOT NULL;

-- ───────────────────────────────────────────────────────
-- 2. Update activate_subscription_after_payment() RPC
--    Look up per-teacher rate FIRST, then fall back to global rate.
--    The snapshot into financial_ledger.commission_rate is unchanged.
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

  -- Idempotency: if order is already 'paid', set flag + fall through
  -- to the ledger reconciliation block (P0 fix from v85).
  IF v_order.status = 'paid' THEN
    v_already_paid := true;
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
    v_already_processed := true;
  END;

  -- Mark order as paid (only if not already).
  IF NOT v_already_paid THEN
    UPDATE public.orders
    SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = p_order_id;
  END IF;

  -- UPSERT enrollment with monthly billing period (unchanged from v78).
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

  -- ── Financial Ledger Reconciliation ──
  -- Runs on EVERY invocation, including idempotency paths.
  -- The pre-check (SELECT EXISTS) + ON CONFLICT (payment_id) DO NOTHING
  -- makes it doubly idempotent — no duplicate rows, ever.
  SELECT EXISTS(
    SELECT 1 FROM public.financial_ledger WHERE payment_id = v_payment_id
  ) INTO v_ledger_exists;

  IF NOT v_ledger_exists AND v_payment_id IS NOT NULL THEN
    -- Snapshot teacher_id from subjects table at payment time.
    SELECT teacher_id INTO v_teacher_id
    FROM public.subjects WHERE id = v_order.subject_id;

    IF v_teacher_id IS NULL THEN
      -- Subject might have been deleted — use a placeholder.
      v_teacher_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    -- Snapshot gateway_id from the order.
    v_gateway_id := v_order.gateway_id;

    -- ── v111: Per-teacher commission rate lookup ──
    -- 1) Try users.commission_percentage for THIS teacher (per-teacher override).
    -- 2) If NULL, fall back to the global active commission_rates row.
    -- 3) If neither exists, use 0%.
    -- The chosen rate is snapshotted into financial_ledger.commission_rate
    -- so future changes to users.commission_percentage do NOT retroactively
    -- affect this ledger row.
    SELECT u.commission_percentage INTO v_commission_rate
    FROM public.users u
    WHERE u.id = v_teacher_id;

    IF v_commission_rate IS NULL THEN
      SELECT rate_percentage INTO v_commission_rate
      FROM public.commission_rates
      WHERE is_active = true
      ORDER BY effective_from DESC
      LIMIT 1;
    END IF;

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

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'student_id', v_order.student_id,
    'already_paid', v_already_paid,
    'already_processed', v_already_processed,
    'ledger_reconciled', (NOT v_ledger_exists) AND (v_payment_id IS NOT NULL)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Preserve the existing GRANT (v78 granted to authenticated, anon, service_role)
GRANT EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) IS
  'v111: activates the subscription AND records the financial_ledger row. Looks up per-teacher commission (users.commission_percentage) FIRST, falls back to global commission_rates. The chosen rate is snapshotted into financial_ledger.commission_rate — changes to either rate do NOT retroactively affect existing ledger rows. Idempotent.';

-- ───────────────────────────────────────────────────────
-- 3. RLS: users.commission_percentage is read by the user themselves
--    (teacher reading their own rate for display) and writable only
--    by the service role (admin via requireAdmin). The existing
--    users RLS policies already cover this — we just need to ensure
--    no NEW write policies are accidentally added.
--    No action needed.
-- ───────────────────────────────────────────────────────

-- Done.
-- Verify:
--   \d public.users  -- should show commission_percentage NUMERIC(5,2)
--   SELECT id, name, role, commission_percentage FROM public.users WHERE role = 'teacher';
--   SELECT proname, prosrc FROM pg_proc WHERE proname = 'activate_subscription_after_payment';
