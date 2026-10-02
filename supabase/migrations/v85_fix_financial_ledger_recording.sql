-- =====================================================
-- v85: P0 FIX — Money Not Recorded (financial_ledger)
-- =====================================================
-- BUG: activate_subscription_after_payment had two early-RETURN
-- paths that exited the entire function BEFORE reaching the
-- financial_ledger INSERT:
--
--   1. Line 154-156 (v78):
--        IF v_order.status = 'paid' THEN
--          RETURN jsonb_build_object('success', true, 'already_paid', true);
--        END IF;
--
--   2. Line 163-167 (v78): EXCEPTION WHEN unique_violation THEN ... RETURN
--      — In PL/pgSQL, RETURN inside an EXCEPTION block exits the
--        ENTIRE function, not just the BEGIN/END.
--
-- IMPACT: Paymob collected money from students, but the platform
-- never created the financial_ledger row. The admin dashboard
-- showed $0 revenue. Teachers were underpaid. The team shipped a
-- backfill-financial-ledger endpoint as a manual workaround, but
-- the underlying RPC kept creating new orphaned paid orders on
-- every retry.
--
-- FIX: Replace the RPC so that BOTH idempotency paths fall through
-- to a reconciliation block that ALWAYS attempts the ledger INSERT
-- (idempotent via ON CONFLICT DO NOTHING). Specifically:
--
--   • The "order already paid" path no longer RETURNs — it sets a
--     flag and falls through to the ledger reconciliation.
--   • The "payment unique_violation" path no longer RETURNs — it
--     fetches the existing payment_id and falls through.
--   • The ledger INSERT block runs on every invocation, with a
--     pre-check (SELECT EXISTS) and ON CONFLICT (payment_id)
--     DO NOTHING for double-idempotency.
--
-- BACKWARD COMPATIBILITY:
--   • Function signature unchanged — same params, same return shape.
--   • Existing paid orders WITH ledger rows are unaffected
--     (SELECT EXISTS skips the INSERT).
--   • Existing paid orders WITHOUT ledger rows get retroactively
--     reconciled on the next webhook retry OR on a manual
--     force-activate call.
--
-- SECURITY:
--   • SECURITY DEFINER + service-role-only INSERT into
--     financial_ledger (matches v78's RLS posture).
--   • No new privileges granted. The existing GRANT EXECUTE
--     on `authenticated, anon, service_role` is preserved.
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

  -- Idempotency flag #1: order is already 'paid'. DO NOT RETURN —
  -- we still need to reconcile the ledger below (the previous run
  -- may have crashed after marking the order paid but before
  -- inserting the ledger row).
  IF v_order.status = 'paid' THEN
    v_already_paid := true;
  END IF;

  -- Insert the payment record (UNIQUE on provider_payment_id = idempotency).
  -- On unique_violation, fetch the existing payment_id so we can
  -- reconcile the ledger. DO NOT RETURN — fall through to the
  -- reconciliation block.
  BEGIN
    INSERT INTO public.payments (order_id, provider_payment_id, amount, currency, status, raw_payload, confirmed_by)
    VALUES (p_order_id, p_provider_payment_id, p_amount, p_currency, p_status, p_raw_payload, p_confirmed_by)
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    -- Payment already exists — fetch its id so we can reconcile the ledger.
    SELECT id INTO v_payment_id
    FROM public.payments
    WHERE provider_payment_id = p_provider_payment_id;
    v_already_processed := true;
  END;

  -- Mark order as paid (idempotent — only flips non-paid rows).
  UPDATE public.orders
  SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
  WHERE id = p_order_id AND status != 'paid';

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

  -- ── Financial Ledger Reconciliation (P0 FIX) ──
  -- This block runs on EVERY invocation, including the two
  -- idempotency paths (already_paid, already_processed). The
  -- pre-check (SELECT EXISTS) + ON CONFLICT (payment_id) DO NOTHING
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
  'P0 fix (v85): activates the subscription AND records the financial_ledger row. Idempotent — both "order already paid" and "payment already exists" paths fall through to the ledger reconciliation block. Returns {success, already_paid, already_processed, ledger_reconciled}.';

-- =====================================================
-- Operator action: AFTER applying this migration, run the
-- existing backfill endpoint ONCE to recover orphaned paid
-- orders that were created BEFORE the fix:
--
--   POST /api/admin/backfill-financial-ledger
--
-- This will scan all paid orders, find ones with no
-- financial_ledger row, and insert the missing rows using the
-- same snapshotted values (teacher_id, commission_rate, etc.).
-- =====================================================
