-- v108: Fix orders FK chain — change to ON DELETE CASCADE
-- Defensive: checks if column exists before adding constraint

-- 1. financial_ledger.order_id → CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'financial_ledger' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.financial_ledger
      DROP CONSTRAINT IF EXISTS financial_ledger_order_id_fkey;
    ALTER TABLE public.financial_ledger
      ADD CONSTRAINT financial_ledger_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'financial_ledger: %', SQLERRM;
END $$;

-- 2. payments.order_id → CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.payments
      DROP CONSTRAINT IF EXISTS payments_order_id_fkey;
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'payments: %', SQLERRM;
END $$;

-- 3. teacher_payout_ledger_entries.order_id → SET NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teacher_payout_ledger_entries' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE public.teacher_payout_ledger_entries
      DROP CONSTRAINT IF EXISTS teacher_payout_ledger_entries_order_id_fkey;
    ALTER TABLE public.teacher_payout_ledger_entries
      ADD CONSTRAINT teacher_payout_ledger_entries_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'teacher_payout_ledger_entries: %', SQLERRM;
END $$;

-- Done.
