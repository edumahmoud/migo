-- =============================================================
-- v81_payout_method_type_corrections.sql
-- AttenDo LMS — Phase 13 Step 1: Payout Methods Architecture Correction
--
-- Refactors the `teacher_payout_methods.method_type` from 4
-- wallet-specific values (tied to Egyptian mobile operators) to
-- 4 generic, provider-independent values:
--
--   BEFORE (Phase 11):                 AFTER (Phase 13 Step 1):
--   vodafone_cash                       wallet
--   etisalat_cash                       wallet
--   orange_cash                         wallet
--   we_cash                             wallet
--
-- Plus 3 NEW types added in this correction:
--   bank_account   (bank_name + account_number OR iban + holder_name)
--   bank_card      (last4 + card_brand? + expiry + holder_name — NO PAN, NO CVV)
--   instapay       (recipient identifier + holder_name)
--
-- Design principle:
--   Payout Method ≠ Payout Provider. A method_type describes the
--   SHAPE of the recipient data the teacher supplied. The provider
--   that will actually execute the transfer is selected LATER
--   (Phase 13 Step 10) based on capabilities + availability.
--
-- Migration backward compatibility:
--   - The encrypted blobs for old wallet-specific rows ALREADY use
--     the field shape { wallet_number, holder_name }, which is
--     EXACTLY what the new generic 'wallet' schema expects.
--   - NO re-encryption is needed. The migration only UPDATEs the
--     `method_type` column value.
--   - The masked summary (`details_masked`) remains valid — its
--     format ("**** **** 5678 • M. A.") is identical for the
--     'wallet' schema after correction.
--   - Audit history is preserved: `teacher_payout_method_audit_log`
--     has NO method_type column, only generic events.
--
-- Safe migration procedure (transactional):
--   1. Drop the old CHECK constraint.
--   2. Add a temporary CHECK that allows BOTH old and new types
--      (so we can UPDATE rows without violating the constraint).
--   3. UPDATE all 4 old wallet-specific types → 'wallet'.
--   4. Drop the temporary CHECK + add the final CHECK with the 4
--      new generic types only.
--   5. Verify no orphan rows remain.
--
-- This migration is IDEMPOTENT — safe to re-run if needed.
-- =============================================================

-- ─── 1. Drop the old CHECK constraint ───
-- (PostgreSQL auto-names it teacher_payout_methods_method_type_check
-- when created inline in CREATE TABLE.)
ALTER TABLE public.teacher_payout_methods
  DROP CONSTRAINT IF EXISTS teacher_payout_methods_method_type_check;

-- ─── 2. Add temporary CHECK allowing BOTH old and new types ───
-- This lets us UPDATE existing rows without a constraint violation
-- (e.g., if a row is 'vodafone_cash' and we UPDATE it to 'wallet',
-- both values are valid during the transition).
ALTER TABLE public.teacher_payout_methods
  ADD CONSTRAINT teacher_payout_methods_method_type_check
  CHECK (method_type IN (
    -- OLD (transient — only allowed during this migration)
    'vodafone_cash',
    'etisalat_cash',
    'orange_cash',
    'we_cash',
    -- NEW (Phase 13 Step 1 Architecture Correction)
    'wallet',
    'bank_account',
    'bank_card',
    'instapay'
  ));

-- ─── 3. Migrate existing rows ───
-- All 4 old wallet-specific types → 'wallet'.
-- The encrypted blob already contains { wallet_number, holder_name }
-- which is exactly what the new 'wallet' schema expects — NO
-- re-encryption needed.
UPDATE public.teacher_payout_methods
  SET method_type = 'wallet',
      updated_at = now()
  WHERE method_type IN (
    'vodafone_cash',
    'etisalat_cash',
    'orange_cash',
    'we_cash'
  );

-- ─── 4. Drop the temporary CHECK + add the final CHECK ───
-- Only the 4 generic types are now allowed.
ALTER TABLE public.teacher_payout_methods
  DROP CONSTRAINT teacher_payout_methods_method_type_check;

ALTER TABLE public.teacher_payout_methods
  ADD CONSTRAINT teacher_payout_methods_method_type_check
  CHECK (method_type IN (
    'wallet',
    'bank_account',
    'bank_card',
    'instapay'
  ));

-- ─── 5. Verify no orphan rows remain ───
-- Run this query manually after migration to confirm:
--   SELECT method_type, COUNT(*)
--   FROM public.teacher_payout_methods
--   GROUP BY method_type
--   ORDER BY method_type;
--
-- Expected result: only 'wallet', 'bank_account', 'bank_card', 'instapay'.
-- No rows should have any of: vodafone_cash, etisalat_cash,
-- orange_cash, we_cash.

-- ─── Note on UNIQUE constraint ───
-- The existing UNIQUE(teacher_id, method_type, details_masked)
-- constraint remains valid for the new types:
--   - A teacher can have one 'wallet' with phone X (masked)
--   - A teacher can have one 'bank_account' with masked IBAN X
--   - A teacher can have one 'bank_card' with masked last4 X
--   - A teacher can have one 'instapay' with masked identifier X
--
-- Edge case: if a teacher had BOTH a vodafone_cash AND an
-- etisalat_cash row with the same wallet_number (same masked value),
-- the UPDATE in step 3 would violate the UNIQUE constraint because
-- both rows would become ('wallet', '<same masked value>') for the
-- same teacher. This is extremely unlikely (one phone = one operator)
-- but if it happens, the migration transaction rolls back and the
-- admin must manually merge the two rows before re-running.

-- ─── Note on audit log ───
-- `teacher_payout_method_audit_log.event` CHECK constraint is
-- method_type-agnostic (events are: created, updated, set_default,
-- disabled, reenabled, verified). NO migration needed for the audit
-- log table — history is fully preserved.

-- ─── Note on RLS ───
-- RLS policies on `teacher_payout_methods` filter by `teacher_id`,
-- NOT by method_type. They remain valid after this migration.

-- Done.
