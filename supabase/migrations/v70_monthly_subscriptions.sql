-- =============================================================
-- v70_monthly_subscriptions.sql
-- AttenDo LMS — Convert self-paid course access from permanent to monthly.
--
-- Courses are NOT permanent purchases. They are monthly subscriptions.
-- A successful payment activates the subscription for ONE billing period.
--
-- New columns on subject_students (all nullable — backward compatible):
--   * current_period_start  — when the current billing period started
--   * current_period_end    — when access expires (start + 1 month)
--   * next_billing_at       — when the next payment is due (= period_end)
--   * monthly_price         — snapshot of the price at payment time
--
-- Backward compatibility:
--   * Agent-registered / self-join / teacher_add enrollments have
--     current_period_end = NULL → permanent access (unchanged).
--   * Only 'self_paid' enrollments get a non-NULL period_end.
--   * get_student_subject_ids() returns rows where period_end IS NULL
--     (permanent) OR period_end > now() (active monthly sub).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Add subscription period columns to subject_students
-- -------------------------------------------------------------
ALTER TABLE public.subject_students
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_billing_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monthly_price        NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_subject_students_period_end
  ON public.subject_students(student_id, current_period_end)
  WHERE current_period_end IS NOT NULL;

-- -------------------------------------------------------------
-- 2. Update get_student_subject_ids() to respect expiry
--
-- Returns subject_ids where:
--   status = 'approved' AND
--   (current_period_end IS NULL → permanent access OR
--    current_period_end > now() → active monthly subscription)
--
-- Expired monthly subscriptions (period_end <= now) are NOT returned
-- → student loses access to that course's content until they renew.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_student_subject_ids(student_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT subject_id FROM public.subject_students
  WHERE student_id = get_student_subject_ids.student_id
    AND status = 'approved'
    AND (current_period_end IS NULL OR current_period_end > now());
$$;

-- Re-grant (CREATE OR REPLACE may drop grants in some PG versions).
GRANT EXECUTE ON FUNCTION public.get_student_subject_ids(UUID) TO authenticated, anon;

-- -------------------------------------------------------------
-- 3. Updated activate_subscription_after_payment() RPC
--
-- The enrollment UPSERT now sets billing period dates:
--   * First payment: current_period_start = now(), end = now() + 1 month.
--   * Renewal BEFORE expiry: EXTEND from current end → end + 1 month.
--   * Renewal AFTER expiry: start fresh → start = now(), end = now() + 1 month.
--
-- monthly_price is snapshotted from the order amount at payment time.
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
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.amount != p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_mismatch',
      'expected', v_order.amount, 'got', p_amount);
  END IF;
  IF v_order.currency != p_currency THEN
    RETURN jsonb_build_object('success', false, 'error', 'currency_mismatch',
      'expected', v_order.currency, 'got', p_currency);
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'already_paid', true);
  END IF;

  BEGIN
    INSERT INTO public.payments (order_id, provider_payment_id, amount, currency, status, raw_payload, confirmed_by)
    VALUES (p_order_id, p_provider_payment_id, p_amount, p_currency, p_status, p_raw_payload, p_confirmed_by);
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.orders SET status = 'paid', paid_at = COALESCE(paid_at, now()), updated_at = now()
    WHERE id = p_order_id AND status != 'paid';
    RETURN jsonb_build_object('success', true, 'already_processed', true);
  END;

  UPDATE public.orders
  SET status = 'paid', paid_at = now(), updated_at = now()
  WHERE id = p_order_id;

  -- UPSERT enrollment with monthly billing period.
  -- If existing sub is still active (period_end > now): EXTEND.
  -- If expired or new: start fresh (now → now + 1 month).
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
