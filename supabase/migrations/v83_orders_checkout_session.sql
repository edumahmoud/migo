-- =============================================================
-- v83_orders_checkout_session.sql
-- AttenDo LMS — Multi-Subject Checkout Support
--
-- Adds a nullable `checkout_session_id` UUID column to `orders`.
-- Multiple orders that should be paid together in ONE Paymob
-- Intention share the same `checkout_session_id`.
--
-- DESIGN GOALS:
--   - Smallest compatible backend extension for multi-subject checkout.
--   - Does NOT weaken any existing constraint:
--       * `orders.subject_id` stays NOT NULL (1 order = 1 subject)
--       * `orders.provider_order_ref` stays UNIQUE
--         (still stores the Paymob Intention ID on one order per session)
--       * `orders.gateway_id` stays as the gateway snapshot
--   - Does NOT introduce a parallel payment system.
--   - The existing single-order flow continues to work unchanged:
--     `checkout_session_id` is NULL for single-order payments.
--
-- WEBHOOK RESOLUTION:
--   When the Paymob callback arrives, the webhook reads
--   `special_reference` from the callback. For multi-subject
--   checkout, `special_reference` is the `checkout_session_id`
--   (NOT an order UUID). The webhook then:
--     1. Tries `orders.id = special_reference` (single-order flow)
--     2. If not found, tries `orders WHERE checkout_session_id = special_reference`
--        (multi-subject flow) — returns multiple orders
--     3. For each order, calls `activate_subscription_after_payment`
--        with a per-order unique `provider_payment_id`
--        (`${paymobTxId}:${orderId}`) so each order gets its own
--        payment row + financial_ledger entry.
--
-- RLS:
--   orders already has RLS (student_id = auth.uid()). The new column
--   inherits the same policies — no additional RLS needed.
-- =============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_session_id UUID;

-- Index for the webhook's session lookup (multi-subject flow).
-- Partial index — only rows where checkout_session_id IS NOT NULL
-- (the vast majority of single-subject orders stay NULL).
CREATE INDEX IF NOT EXISTS idx_orders_checkout_session
  ON public.orders(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

-- Done. Verify with:
--   \d public.orders
--   (checkout_session_id should appear as a nullable UUID column)
