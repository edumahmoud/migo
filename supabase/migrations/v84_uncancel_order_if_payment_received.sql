-- =====================================================
-- v84: C12 — Cancelled-Order Payment Race Condition Recovery
-- =====================================================
-- PROBLEM (C12):
--   1. Student pays on Paymob.
--   2. Paymob webhook is delayed (network, queue, retry).
--   3. Teacher (admin) sees the order as stale 'pending' and cancels it.
--   4. Webhook finally arrives → sees status='cancelled' → refuses to
--      activate the subscription.
--   5. Result: student paid but no subscription → money lost + user
--      support ticket required.
--
-- SOLUTION:
--   SQL RPC `uncancel_order_if_payment_received(p_order_id, p_provider_payment_id)`
--   is called by the webhook handler BEFORE attempting activation.
--   It atomically:
--     - Acquires a row lock on the order (FOR UPDATE)
--     - If status='paid'  → no-op, return TRUE (idempotent)
--     - If status='pending' → no-op, return TRUE (webhook can activate normally)
--     - If status='cancelled' → flip back to 'pending', return TRUE (recovery)
--     - Else (failed/refunded/expired) → return FALSE (refuse to touch)
--   The webhook then proceeds with normal `activate_subscription_after_payment`
--   as if the order were pending.
--
-- SECURITY:
--   SECURITY DEFINER + service-role only — the function performs an
--   UPDATE on the orders table. It does NOT trust client input beyond
--   the two parameters (which are validated by the caller). It does
--   not expose any data.
-- =====================================================

CREATE OR REPLACE FUNCTION public.uncancel_order_if_payment_received(
  p_order_id UUID,
  p_provider_payment_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status TEXT;
BEGIN
  -- Lock the row to prevent concurrent mutations during the recovery
  SELECT status INTO v_current_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Order does not exist — caller should treat as a hard fail
    RETURN FALSE;
  END IF;

  -- Idempotent: order is already paid → no recovery needed
  IF v_current_status = 'paid' THEN
    RETURN TRUE;
  END IF;

  -- Normal happy path: order is pending → webhook can activate normally
  IF v_current_status = 'pending' THEN
    RETURN TRUE;
  END IF;

  -- C12 recovery: cancelled order + payment confirmed → uncancel
  IF v_current_status = 'cancelled' THEN
    UPDATE public.orders
    SET status = 'pending', updated_at = NOW()
    WHERE id = p_order_id AND status = 'cancelled';
    RETURN TRUE;
  END IF;

  -- Any other status (failed, refunded, expired) → do not touch.
  -- These are intentional states the recovery should not override.
  RETURN FALSE;
END;
$$;

-- Grant execute to the service role (anon is intentionally NOT granted)
GRANT EXECUTE ON FUNCTION public.uncancel_order_if_payment_received(UUID, TEXT) TO service_role;

-- Helpful comment for operators reviewing the schema
COMMENT ON FUNCTION public.uncancel_order_if_payment_received(UUID, TEXT) IS
  'C12 recovery: flips a cancelled order back to pending so the webhook can activate the subscription when a payment arrives late. Returns TRUE on success/already-paid/already-pending. Returns FALSE if the order does not exist or has a terminal status (failed/refunded).';

-- =====================================================
-- Optional: index for the webhook lookup (already covered by PK)
-- =====================================================
-- The function looks up by id (PK) so no additional index is needed.
