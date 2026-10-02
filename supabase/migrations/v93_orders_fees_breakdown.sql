-- =====================================================
-- v93: Add fees_breakdown column to orders table
-- =====================================================
-- BUG: v88 added fees_breakdown to financial_ledger but FORGOT to
-- add it to the orders table. The orders route SELECTs fees_breakdown
-- from orders → "column orders.fees_breakdown does not exist" error.
-- This makes EVERY order creation fail with the error message:
--   "تعذّر إنشاء الطلب: column orders.fees_breakdown does not exist"
-- =====================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fees_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.orders.fees_breakdown IS
  'JSONB snapshot of fees applied at checkout. Array of {code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount}. Stored at order creation time so the payment dialog + receipt PDF can show the breakdown without re-computing from order_fees.';
