-- =====================================================
-- v108: Fix orders FK chain — change to ON DELETE CASCADE
-- =====================================================
-- financial_ledger.order_id is NOT NULL, so setting it to NULL
-- fails silently. The API can't clean up the FK reference.
-- Change the FK to ON DELETE CASCADE so deleting orders
-- automatically deletes the financial_ledger rows.
-- =====================================================

-- 1. financial_ledger.order_id → CASCADE
ALTER TABLE public.financial_ledger
  DROP CONSTRAINT IF EXISTS financial_ledger_order_id_fkey;
ALTER TABLE public.financial_ledger
  ADD CONSTRAINT financial_ledger_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- 2. payments.order_id → CASCADE
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_order_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- 3. teacher_payout_ledger_entries.order_id → SET NULL (nullable)
ALTER TABLE public.teacher_payout_ledger_entries
  DROP CONSTRAINT IF EXISTS teacher_payout_ledger_entries_order_id_fkey;
ALTER TABLE public.teacher_payout_ledger_entries
  ADD CONSTRAINT teacher_payout_ledger_entries_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

-- Done.
