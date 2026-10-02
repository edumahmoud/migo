-- =====================================================
-- v89: Update activate_subscription_after_payment RPC for fees-on-top
-- =====================================================
-- GOAL: extend the v85 RPC to record the fee breakdown in
-- financial_ledger when a payment is activated.
--
-- The v88 migration added:
--   - financial_ledger.subscription_total  (NUMERIC, default = gross_amount)
--   - financial_ledger.tax_amount          (NUMERIC, default 0)
--   - financial_ledger.other_fees_amount   (NUMERIC, default 0)
--   - financial_ledger.fees_breakdown      (JSONB, default '[]')
--
-- This v89 migration replaces the RPC so it:
--   1. Reads the fees from order_fees (snapshot at order creation)
--   2. Computes:
--      - v_subscription_total = orders.base_amount (what the teacher gets pre-commission)
--      - v_platform_commission_amount = SUM(order_fees.calculated_amount WHERE code='platform_commission')
--      - v_tax_amount = SUM(order_fees.calculated_amount WHERE code='tax' OR code LIKE 'tax_%')
--      - v_other_fees_amount = SUM(order_fees.calculated_amount) - v_platform_commission_amount - v_tax_amount
--      - v_gross_amount = p_amount (what Paymob charged = grand_total)
--      - v_platform_share = v_platform_commission_amount + v_tax_amount + v_other_fees_amount
--        (the platform keeps ALL fees — commission + tax + other)
--      - v_teacher_share = v_subscription_total - v_platform_commission_amount
--        (the teacher keeps the subscription TOTAL minus the platform's
--         commission. Tax and other fees are NOT deducted from the
--         teacher — they're collected on behalf of the platform/government
--         and never belonged to the teacher.)
--   3. Inserts all these columns into financial_ledger (in addition to
--      the existing gross_amount, platform_share, teacher_share columns
--      which are kept for backward compat with the admin dashboard)
--
-- For orders created BEFORE v88 (no order_fees rows): the existing
-- columns stay (= gross_amount = base_amount, no breakdown). The new
-- columns default to: subscription_total = gross_amount, tax = 0,
-- other = 0, fees_breakdown = '[]'. This preserves backward
-- compatibility — old receipts still work, old ledger numbers stay
-- correct.
-- =====================================================

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
  -- v88 — fee breakdown
  v_subscription_total        NUMERIC(12,2);
  v_platform_commission_amt  NUMERIC(12,2) := 0;
  v_tax_amount               NUMERIC(12,2) := 0;
  v_other_fees_amount        NUMERIC(12,2) := 0;
  v_fees_breakdown           JSONB := '[]'::jsonb;
  v_fee_row                 RECORD;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- v88 — compare against grand_total (= base_amount + fees_total).
  -- Fall back to orders.amount for orders created before v88.
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
      'expected', v_order.currency, 'get', p_currency);
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
    -- Snapshot teacher_id from subjects table at payment time
    SELECT teacher_id INTO v_teacher_id
    FROM public.subjects WHERE id = v_order.subject_id;

    IF v_teacher_id IS NULL THEN
      v_teacher_id := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;

    v_gateway_id := v_order.gateway_id;

    -- v88 — Read fee breakdown from order_fees (snapshot at order creation)
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
      -- Aggregate by category: 'platform_commission' / 'tax*' / other
      IF v_fee_row.code = 'platform_commission' THEN
        v_platform_commission_amt := v_platform_commission_amt + v_fee_row.calculated_amount;
      ELSIF v_fee_row.code LIKE 'tax%' THEN
        v_tax_amount := v_tax_amount + v_fee_row.calculated_amount;
      ELSE
        v_other_fees_amount := v_other_fees_amount + v_fee_row.calculated_amount;
      END IF;
    END LOOP;

    -- v88 financial calculations:
    --   - gross_amount = grand_total = what Paymob charged the student
    --   - platform_share = commission + tax + other fees (all stay with platform)
    --   - teacher_share = subscription_total - platform_commission
    --     (teacher keeps the subscription value, MINUS the platform's
    --      commission cut. Tax + other fees never belonged to the teacher.)
    v_gross_amount := p_amount;
    v_platform_share := v_platform_commission_amt + v_tax_amount + v_other_fees_amount;
    v_teacher_share := v_subscription_total - v_platform_commission_amt;
    v_net_amount := v_teacher_share;

    -- Snapshot commission_rate (legacy — kept for backward compat with
    -- admin commission-rates UI). Read from the active commission_rates
    -- row OR derive from the order_fees snapshot.
    SELECT rate_percentage INTO v_commission_rate
    FROM public.commission_rates WHERE is_active = true
    ORDER BY effective_from DESC LIMIT 1;
    IF v_commission_rate IS NULL THEN
      v_commission_rate := 0;
    END IF;

    INSERT INTO public.financial_ledger (
      payment_id, order_id, student_id, subject_id, teacher_id,
      gateway_id, provider_payment_id, currency,
      gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
      commission_rate, status,
      -- v88 — new columns
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

GRANT EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) IS
  'v89: extends v85 with fees-on-top support. Reads order_fees snapshot, splits platform_share into commission + tax + other, and computes teacher_share = subscription_total - platform_commission (tax + other fees stay with platform). Records fees_breakdown JSONB for receipts/audit.';
