-- =============================================================
-- v116_orders_plan_duration.sql
-- AttenDo LMS — Link subscription plan duration to activated periods.
--
-- Bug being fixed:
--   v113 introduced subject_subscription_plans (monthly/term/yearly)
--   with a `duration_days` column. But the orders table didn't store
--   plan_id, so the activation flow (RPC + TS fallback UPSERT) had
--   NO way to know which plan was selected. Both code paths fell
--   back to a hardcoded 30-day period, so:
--     - A yearly plan (365 days) was activated as if it were monthly.
--     - A term plan (120 days) was activated as if it were monthly.
--     - A monthly plan (30 days) was correct only by coincidence.
--
-- Fix:
--   1. Add orders.plan_id (FK to subject_subscription_plans, nullable).
--   2. Add orders.plan_duration_days (INTEGER, nullable) — snapshot of
--      the plan's duration_days at checkout time. Stored on the order
--      so future plan edits don't retroactively change already-paid
--      periods. Mirrors the existing monthly_price snapshot pattern
--      on subject_students.
--   3. Update activate_subscription_after_payment() RPC to accept a
--      new `p_period_days` parameter (default 30) and use it via
--      `make_interval(days => p_period_days)` instead of the
--      hardcoded `interval '1 month'`.
--   4. Add an index on plan_id for the (rare) case where someone
--      wants to query all orders for a specific plan.
--
-- Backward compatibility:
--   - All existing orders have plan_id = NULL and plan_duration_days
--     = NULL. The RPC defaults p_period_days to 30 when NULL, so
--     existing orders continue to activate as 30-day monthly
--     subscriptions. No backfill is needed.
--   - The RPC signature change is purely additive (new optional
--     parameter). Existing callers (TS code) still work, they just
--     don't pass the new parameter until they're updated to read
--     plan_duration_days from the order row.
-- =============================================================

-- 1. Add plan_id + plan_duration_days columns.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS plan_id UUID
    REFERENCES public.subject_subscription_plans(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS plan_duration_days INTEGER;

COMMENT ON COLUMN public.orders.plan_id IS
  'FK to subject_subscription_plans. NULL for orders created before v113 or when no plan was selected.';
COMMENT ON COLUMN public.orders.plan_duration_days IS
  'Snapshot of subject_subscription_plans.duration_days at checkout time. NULL = use default (30 days). Stored on the order so plan edits do not retroactively change already-activated periods.';

CREATE INDEX IF NOT EXISTS idx_orders_plan_id
  ON public.orders(plan_id)
  WHERE plan_id IS NOT NULL;

-- 2. Update the activate_subscription_after_payment() RPC to accept
--    p_period_days and use it instead of the hardcoded
--    interval '1 month'.
--
--    IMPORTANT: This is a FULL replacement of the function. The
--    function body is identical to v112 except for the new
--    parameter + the make_interval call. We keep v112's
--    per-teacher commission logic + financial_ledger reconciliation
--    + idempotency fall-through paths intact.
--
--    The function is replaced with `OR REPLACE` so the new parameter
--    is added without needing to drop + recreate (which would lose
--    GRANTs).
CREATE OR REPLACE FUNCTION public.activate_subscription_after_payment(
  p_order_id UUID,
  p_provider_payment_id TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_status TEXT,
  p_raw_payload JSONB,
  p_confirmed_by UUID DEFAULT NULL,
  p_period_days INTEGER DEFAULT 30
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
  v_subscription_total NUMERIC(12,2);
  v_fee_row RECORD;
  v_existing_payment UUID;
  v_already_paid BOOLEAN := false;
  v_period_days INTEGER := COALESCE(p_period_days, 30);
  v_period_interval INTERVAL;
BEGIN
  -- Validate period days (defensive — callers should pass sane values).
  IF v_period_days <= 0 OR v_period_days > 3650 THEN
    v_period_days := 30;
  END IF;
  v_period_interval := make_interval(days => v_period_days);

  -- ─── 1. Load the order row ───
  SELECT
    o.id, o.student_id, o.subject_id, o.amount, o.currency,
    o.status, o.provider_order_ref, o.base_amount, o.grand_total,
    o.fees_breakdown, o.gateway_id, o.plan_id, o.plan_duration_days
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- If the order carries a plan_duration_days snapshot, prefer it
  -- over the parameter (the snapshot is the source of truth).
  IF v_order.plan_duration_days IS NOT NULL AND v_order.plan_duration_days > 0 AND v_order.plan_duration_days <= 3650 THEN
    v_period_days := v_order.plan_duration_days;
    v_period_interval := make_interval(days => v_period_days);
  END IF;

  -- ─── 2. Idempotency: skip if order already paid ───
  IF v_order.status = 'paid' THEN
    v_already_paid := true;
    -- Don't RETURN — fall through to ledger reconciliation (v85 fix).
  END IF;

  -- ─── 3. Insert payment row (idempotent on provider_payment_id) ───
  SELECT id INTO v_existing_payment
  FROM public.payments
  WHERE provider_payment_id = p_provider_payment_id;

  IF v_existing_payment IS NULL THEN
    INSERT INTO public.payments (
      order_id, provider_payment_id, amount, currency, status,
      raw_payload, confirmed_by
    ) VALUES (
      p_order_id, p_provider_payment_id, p_amount, p_currency, p_status,
      p_raw_payload, p_confirmed_by
    )
    ON CONFLICT (provider_payment_id) DO NOTHING
    RETURNING id INTO v_payment_id;

    IF v_payment_id IS NULL THEN
      -- Concurrent insert by webhook — fetch the existing row.
      SELECT id INTO v_payment_id
      FROM public.payments
      WHERE provider_payment_id = p_provider_payment_id;
    END IF;
  ELSE
    v_payment_id := v_existing_payment;
  END IF;

  -- ─── 4. Update order status ───
  UPDATE public.orders
  SET
    status = 'paid',
    paid_at = now(),
    activated_at = now(),
    updated_at = now()
  WHERE id = p_order_id AND status = 'pending';

  -- ─── 5. UPSERT enrollment (use plan duration, not hardcoded month) ───
  INSERT INTO public.subject_students
    (subject_id, student_id, status, enrollment_method, enrolled_at,
     current_period_start, current_period_end, next_billing_at, monthly_price)
  VALUES
    (v_order.subject_id, v_order.student_id, 'approved', 'self_paid', now(),
     now(), now() + v_period_interval, now() + v_period_interval, p_amount)
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
      THEN subject_students.current_period_end + v_period_interval
      ELSE now() + v_period_interval
    END,
    next_billing_at = CASE
      WHEN subject_students.current_period_end IS NOT NULL
           AND subject_students.current_period_end > now()
      THEN subject_students.current_period_end + v_period_interval
      ELSE now() + v_period_interval
    END;

  -- ─── 6. Activate student account (defensive — only pending → active) ───
  UPDATE public.users
  SET account_status = 'active', updated_at = now()
  WHERE id = v_order.student_id
    AND account_status IN ('pending', 'pending_verification', NULL);

  -- ─── 7. Financial ledger (idempotent on payment_id) ───
  SELECT EXISTS(
    SELECT 1 FROM public.financial_ledger WHERE payment_id = v_payment_id
  ) INTO v_ledger_exists;

  IF NOT v_ledger_exists AND v_payment_id IS NOT NULL THEN
    SELECT teacher_id INTO v_teacher_id
    FROM public.subjects WHERE id = v_order.subject_id;

    IF v_teacher_id IS NULL THEN
      v_teacher_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    v_gateway_id := v_order.gateway_id;

    v_subscription_total := COALESCE(v_order.base_amount, v_order.amount);

    FOR v_fee_row IN
      SELECT code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount
      FROM public.order_fees
      WHERE order_id = p_order_id
      ORDER BY sort_order
    LOOP
      IF v_fee_row.code = 'platform_commission' THEN
        -- v112: read per-teacher commission_rate (NULL → global fee_catalog value).
        SELECT commission_rate INTO v_commission_rate
        FROM public.users WHERE id = v_teacher_id;

        IF v_commission_rate IS NULL THEN
          v_commission_rate := v_fee_row.value;
        END IF;

        IF v_fee_row.fee_kind = 'percentage' THEN
          v_platform_share := (v_subscription_total * v_commission_rate) / 100.0;
        ELSE
          v_platform_share := v_fee_row.value;
        END IF;
      ELSIF v_fee_row.code = 'gateway_fee' THEN
        v_gateway_fee := v_fee_row.calculated_amount;
      END IF;
    END LOOP;

    -- v88 fees-on-top: gross = base_amount + fees; platform_share is
    -- a portion of the gross.
    v_gross_amount := COALESCE(v_order.grand_total, v_order.amount);
    IF v_platform_share IS NULL THEN
      v_platform_share := 0;
    END IF;
    v_teacher_share := v_gross_amount - v_platform_share - v_gateway_fee;
    IF v_teacher_share < 0 THEN
      v_teacher_share := 0;
    END IF;
    v_net_amount := v_teacher_share;

    INSERT INTO public.financial_ledger (
      payment_id, order_id, student_id, teacher_id, subject_id,
      gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
      currency, commission_rate, status, created_at, metadata
    ) VALUES (
      v_payment_id, p_order_id, v_order.student_id, v_teacher_id, v_order.subject_id,
      v_gross_amount, v_platform_share, v_teacher_share, v_gateway_fee, v_net_amount,
      v_order.currency, v_commission_rate, 'pending',
      now(),
      jsonb_build_object(
        'plan_id', v_order.plan_id,
        'plan_duration_days', v_period_days,
        'confirmed_by', p_confirmed_by,
        'raw_payload', p_raw_payload
      )
    )
    ON CONFLICT (payment_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_paid', v_already_paid,
    'payment_id', v_payment_id,
    'period_days', v_period_days
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
