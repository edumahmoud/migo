-- =============================================================
-- v76_remove_old_payment_system.sql
-- AttenDo LMS — Remove the old manual proof-of-payment system +
-- mock gateway + admin bypass. This migration cleans up the
-- database schema to prepare for the Paymob integration.
--
-- What this migration does:
--   1. Drops v75 proof columns from orders (sender_name, transaction_ref,
--      proof_notes, proof_submitted_at, proof_url).
--   2. Drops confirmation_mode column from orders (no longer used —
--      all orders are 'pending' until the real payment gateway calls
--      the webhook).
--   3. Drops payment_method_id column from orders (no longer used —
--      the payment method is decided by the gateway, not stored locally).
--   4. Drops the payment_methods table (teacher-managed payment channels
--      like Vodafone Cash numbers, InstaPay handles, etc. are no longer
--      needed — Paymob handles all payment methods internally).
--
-- What this migration does NOT do:
--   - Does NOT delete orders rows (historical orders preserved).
--   - Does NOT delete payments rows (historical payments preserved).
--   - Does NOT delete subject_students rows (enrollments preserved).
--   - Does NOT modify the activate_subscription_after_payment RPC.
--   - Does NOT delete the /api/payment/webhook endpoint (kept for Paymob).
--
-- Safety checks before running:
--   The application code has been cleaned of all references to:
--     - confirmation_mode
--     - payment_method_id / payment_methods
--     - sender_name / transaction_ref / proof_* (in payment context)
--   So dropping these columns is safe.
-- =============================================================

-- 1. Drop v75 proof columns from orders.
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS sender_name;
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS transaction_ref;
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS proof_notes;
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS proof_submitted_at;
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS proof_url;

-- 2. Drop confirmation_mode column (no longer used after the manual
--    approval system was removed).
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS confirmation_mode;

-- 3. Drop payment_method_id column (drops the FK to payment_methods
--    automatically).
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS payment_method_id;

-- 4. Drop the payment_methods table entirely.
--    All teacher-managed payment channels (Vodafone Cash numbers,
--    InstaPay handles, bank account numbers) are removed — Paymob
--    handles all payment methods internally.
DROP TABLE IF EXISTS public.payment_methods CASCADE;

-- 5. Drop the index on proof_submitted_at (column no longer exists).
DROP INDEX IF EXISTS idx_orders_proof_submitted;

-- 6. Update the orders CHECK constraint to remove 'paid' status
--    if it was tied to confirmation logic (it wasn't — the CHECK
--    is just on status values, which are still valid).
--    The existing CHECK on orders.status stays:
--      status IN ('pending','paid','failed','cancelled','refunded')
--    No change needed.

-- 7. Remove the 'paid' RLS policy on orders if it was tied to manual
--    approval (it wasn't — RLS just checks student_id = auth.uid()).
--    No change needed.

-- Done. The database is now clean and ready for Paymob integration.
-- Verify with:
--   \d public.orders
--   \dt public.payment_methods  -- should say "Did not find any relation"
