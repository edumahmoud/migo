-- =====================================================
-- v109: Fix ALL remaining RESTRICT FKs — comprehensive
-- =====================================================
-- Changes every ON DELETE RESTRICT to CASCADE or SET NULL
-- so user/subject deletion never hits a FK wall.
--
-- Idempotent — uses DO blocks with column existence checks.
-- =====================================================

-- 1. financial_ledger.payment_id → CASCADE (was RESTRICT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_ledger' AND column_name = 'payment_id') THEN
    ALTER TABLE public.financial_ledger DROP CONSTRAINT IF EXISTS financial_ledger_payment_id_fkey;
    ALTER TABLE public.financial_ledger ADD CONSTRAINT financial_ledger_payment_id_fkey
      FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '1: %', SQLERRM;
END $$;

-- 2. teacher_payout_ledger_entries.ledger_id → SET NULL (was RESTRICT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payout_ledger_entries' AND column_name = 'ledger_id') THEN
    -- Check if column is nullable first
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payout_ledger_entries' AND column_name = 'ledger_id' AND is_nullable = 'YES') THEN
      ALTER TABLE public.teacher_payout_ledger_entries DROP CONSTRAINT IF EXISTS teacher_payout_ledger_entries_ledger_id_fkey;
      ALTER TABLE public.teacher_payout_ledger_entries ADD CONSTRAINT teacher_payout_ledger_entries_ledger_id_fkey
        FOREIGN KEY (ledger_id) REFERENCES public.financial_ledger(id) ON DELETE SET NULL;
    ELSE
      -- NOT NULL column — use CASCADE instead
      ALTER TABLE public.teacher_payout_ledger_entries DROP CONSTRAINT IF EXISTS teacher_payout_ledger_entries_ledger_id_fkey;
      ALTER TABLE public.teacher_payout_ledger_entries ADD CONSTRAINT teacher_payout_ledger_entries_ledger_id_fkey
        FOREIGN KEY (ledger_id) REFERENCES public.financial_ledger(id) ON DELETE CASCADE;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '2: %', SQLERRM;
END $$;

-- 3. teacher_payout_ledger_entries.payout_id → CASCADE (was RESTRICT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payout_ledger_entries' AND column_name = 'payout_id') THEN
    ALTER TABLE public.teacher_payout_ledger_entries DROP CONSTRAINT IF EXISTS teacher_payout_ledger_entries_payout_id_fkey;
    ALTER TABLE public.teacher_payout_ledger_entries ADD CONSTRAINT teacher_payout_ledger_entries_payout_id_fkey
      FOREIGN KEY (payout_id) REFERENCES public.teacher_payouts(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '3: %', SQLERRM;
END $$;

-- 4. teacher_payout_audit_log.payout_id → CASCADE (was RESTRICT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payout_audit_log' AND column_name = 'payout_id') THEN
    ALTER TABLE public.teacher_payout_audit_log DROP CONSTRAINT IF EXISTS teacher_payout_audit_log_payout_id_fkey;
    ALTER TABLE public.teacher_payout_audit_log ADD CONSTRAINT teacher_payout_audit_log_payout_id_fkey
      FOREIGN KEY (payout_id) REFERENCES public.teacher_payouts(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '4: %', SQLERRM;
END $$;

-- 5. teacher_payout_methods.teacher_id → SET NULL (in case it's RESTRICT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payout_methods' AND column_name = 'teacher_id') THEN
    ALTER TABLE public.teacher_payout_methods DROP CONSTRAINT IF EXISTS teacher_payout_methods_teacher_id_fkey;
    ALTER TABLE public.teacher_payout_methods ADD CONSTRAINT teacher_payout_methods_teacher_id_fkey
      FOREIGN KEY (teacher_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '5: %', SQLERRM;
END $$;

-- 6. teacher_payouts.teacher_id → SET NULL (in case it's RESTRICT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payouts' AND column_name = 'teacher_id') THEN
    ALTER TABLE public.teacher_payouts DROP CONSTRAINT IF EXISTS teacher_payouts_teacher_id_fkey;
    ALTER TABLE public.teacher_payouts ADD CONSTRAINT teacher_payouts_teacher_id_fkey
      FOREIGN KEY (teacher_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '6: %', SQLERRM;
END $$;

-- 7. teacher_payouts.initiated_by → SET NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payouts' AND column_name = 'initiated_by') THEN
    ALTER TABLE public.teacher_payouts DROP CONSTRAINT IF EXISTS teacher_payouts_initiated_by_fkey;
    ALTER TABLE public.teacher_payouts ADD CONSTRAINT teacher_payouts_initiated_by_fkey
      FOREIGN KEY (initiated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '7: %', SQLERRM;
END $$;

-- 8. teacher_payout_audit_log.actor_id → SET NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_payout_audit_log' AND column_name = 'actor_id') THEN
    ALTER TABLE public.teacher_payout_audit_log DROP CONSTRAINT IF EXISTS teacher_payout_audit_log_actor_id_fkey;
    ALTER TABLE public.teacher_payout_audit_log ADD CONSTRAINT teacher_payout_audit_log_actor_id_fkey
      FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '8: %', SQLERRM;
END $$;

-- Done.
