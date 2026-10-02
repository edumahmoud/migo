-- =============================================================
-- v82_teacher_payouts.sql
-- AttenDo LMS — Phase 13 Step 2: Payout Data Model
--
-- Creates 3 tables + 3 DB-level trigger functions that enforce
-- all financial invariants at the database level:
--
--   1. teacher_payouts — payout operation records
--   2. teacher_payout_ledger_entries — link table (double-payout prevention)
--   3. teacher_payout_audit_log — lifecycle events (RESTRICT deletion)
--
-- Triggers:
--   A. check_payout_method_ownership() — BEFORE INSERT OR UPDATE
--      on teacher_payouts: payout_method_id must belong to same teacher_id
--   B. check_payout_ledger_integrity() — BEFORE INSERT on
--      teacher_payout_ledger_entries: amount/teacher/currency integrity
--      + concurrent-safe via advisory lock
--   C. protect_payout_immutability() — BEFORE UPDATE on teacher_payouts:
--      snapshot + amount immutable from creation, status lifecycle,
--      completion requires SUM(linked) = amount
-- =============================================================

-- -------------------------------------------------------------
-- 1. teacher_payouts table
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teacher_payouts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id                  UUID NOT NULL,
  payout_method_id            UUID REFERENCES public.teacher_payout_methods(id) ON DELETE SET NULL,

  -- Immutable Payout Method Snapshot (non-secret only)
  payout_method_type          TEXT NOT NULL CHECK (payout_method_type IN (
    'wallet', 'bank_account', 'bank_card', 'instapay'
  )),
  payout_method_display_label TEXT NOT NULL,
  payout_method_masked        TEXT NOT NULL,

  -- Payout Amount (immutable after INSERT)
  amount                      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency                    TEXT NOT NULL DEFAULT 'EGP',

  -- Status Lifecycle
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),

  -- Idempotency (DB-level uniqueness)
  idempotency_key             TEXT NOT NULL,
  internal_reference          TEXT NOT NULL,

  -- Provider Reference (nullable — future Step 6)
  provider_reference          TEXT,
  failure_reason              TEXT,

  -- Actor Tracking
  initiated_by                UUID NOT NULL,
  initiated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at                 TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(idempotency_key),
  UNIQUE(internal_reference)
);

CREATE INDEX IF NOT EXISTS idx_teacher_payouts_teacher
  ON public.teacher_payouts(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_payouts_status
  ON public.teacher_payouts(status, created_at DESC)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_teacher_payouts_method
  ON public.teacher_payouts(payout_method_id)
  WHERE payout_method_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teacher_payouts_created
  ON public.teacher_payouts(created_at DESC);

-- -------------------------------------------------------------
-- 2. teacher_payout_ledger_entries (link table)
--    UNIQUE(ledger_id) = DB-level double-payout prevention
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teacher_payout_ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id       UUID NOT NULL REFERENCES public.teacher_payouts(id) ON DELETE RESTRICT,
  ledger_id       UUID NOT NULL REFERENCES public.financial_ledger(id) ON DELETE RESTRICT,
  teacher_id      UUID NOT NULL,
  amount_settled  NUMERIC(12,2) NOT NULL CHECK (amount_settled > 0),
  currency        TEXT NOT NULL DEFAULT 'EGP',
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ledger_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_ledger_payout
  ON public.teacher_payout_ledger_entries(payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_ledger_teacher
  ON public.teacher_payout_ledger_entries(teacher_id, settled_at DESC);

-- -------------------------------------------------------------
-- 3. teacher_payout_audit_log table
--    ON DELETE RESTRICT — audit history cannot disappear
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teacher_payout_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id       UUID NOT NULL REFERENCES public.teacher_payouts(id) ON DELETE RESTRICT,
  teacher_id      UUID NOT NULL,
  event           TEXT NOT NULL CHECK (event IN (
    'payout.created', 'payout.processing', 'payout.completed',
    'payout.failed', 'payout.cancelled'
  )),
  actor_id        UUID,
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_payout
  ON public.teacher_payout_audit_log(payout_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payout_audit_teacher
  ON public.teacher_payout_audit_log(teacher_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payout_audit_event
  ON public.teacher_payout_audit_log(event, created_at);

-- =============================================================
-- TRIGGER A: check_payout_method_ownership()
--   BEFORE INSERT OR UPDATE on teacher_payouts
--   Enforces: payout_method_id belongs to same teacher_id
-- =============================================================

CREATE OR REPLACE FUNCTION public.check_payout_method_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method_teacher_id UUID;
BEGIN
  IF NEW.payout_method_id IS NOT NULL THEN
    SELECT teacher_id INTO v_method_teacher_id
    FROM public.teacher_payout_methods
    WHERE id = NEW.payout_method_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payout method % does not exist', NEW.payout_method_id;
    END IF;

    IF v_method_teacher_id != NEW.teacher_id THEN
      RAISE EXCEPTION 'Payout method ownership violation: method % belongs to teacher %, payout is for teacher %',
        NEW.payout_method_id, v_method_teacher_id, NEW.teacher_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_payout_method_ownership ON public.teacher_payouts;
CREATE TRIGGER trg_check_payout_method_ownership
  BEFORE INSERT OR UPDATE OF payout_method_id, teacher_id ON public.teacher_payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.check_payout_method_ownership();

-- =============================================================
-- TRIGGER B: check_payout_ledger_integrity()
--   BEFORE INSERT on teacher_payout_ledger_entries
--
--   Enforces:
--     - teacher_id matches financial_ledger.teacher_id
--     - teacher_id matches teacher_payouts.teacher_id
--     - currency matches financial_ledger.currency
--     - currency matches teacher_payouts.currency
--     - amount_settled <= financial_ledger.teacher_share
--     - cumulative SUM(amount_settled) <= teacher_payouts.amount
--     - payout.status must be 'pending'
--
--   Concurrency safety:
--     Uses pg_advisory_xact_lock() to serialize concurrent INSERTs
--     for the same payout_id. This guarantees the SUM check is
--     atomic — two concurrent transactions cannot both read the
--     same existing SUM and both pass.
--
--     The advisory lock is transaction-scoped (released on
--     commit/rollback). Combined with FOR UPDATE on the parent
--     payout row, this provides defense-in-depth serialization.
-- =============================================================

CREATE OR REPLACE FUNCTION public.check_payout_ledger_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout        RECORD;
  v_ledger        RECORD;
  v_cumulative    NUMERIC(12,2);
BEGIN
  -- ── Concurrency safety: advisory lock ──
  -- Serializes concurrent INSERTs for the same payout_id.
  -- Without this, two transactions could both read the same SUM
  -- and both pass the cumulative check, then both INSERT,
  -- making SUM > payout.amount.
  PERFORM pg_advisory_xact_lock(hashtext('payout_link:' || NEW.payout_id::text));

  -- Fetch + lock the payout row
  SELECT amount, currency, teacher_id, status
    INTO v_payout
  FROM public.teacher_payouts
  WHERE id = NEW.payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked payout_id % does not exist', NEW.payout_id;
  END IF;

  IF v_payout.status != 'pending' THEN
    RAISE EXCEPTION 'Cannot link ledger entries to payout % — status is % (must be pending)',
      NEW.payout_id, v_payout.status;
  END IF;

  -- Teacher ownership: link teacher_id = payout teacher_id
  IF NEW.teacher_id != v_payout.teacher_id THEN
    RAISE EXCEPTION 'Teacher ID mismatch: link teacher_id=% does not match payout teacher_id=%',
      NEW.teacher_id, v_payout.teacher_id;
  END IF;

  -- Currency consistency: link currency = payout currency
  IF NEW.currency != v_payout.currency THEN
    RAISE EXCEPTION 'Currency mismatch: link currency=% does not match payout currency=%',
      NEW.currency, v_payout.currency;
  END IF;

  -- Fetch + lock the ledger row
  SELECT teacher_id, currency, teacher_share
    INTO v_ledger
  FROM public.financial_ledger
  WHERE id = NEW.ledger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked ledger_id % does not exist', NEW.ledger_id;
  END IF;

  -- Teacher ownership: link teacher_id = ledger teacher_id
  IF NEW.teacher_id != v_ledger.teacher_id THEN
    RAISE EXCEPTION 'Teacher ownership violation: link teacher_id=% does not match ledger teacher_id=%',
      NEW.teacher_id, v_ledger.teacher_id;
  END IF;

  -- Currency consistency: link currency = ledger currency
  IF NEW.currency != v_ledger.currency THEN
    RAISE EXCEPTION 'Currency mismatch: link currency=% does not match ledger currency=%',
      NEW.currency, v_ledger.currency;
  END IF;

  -- Amount integrity: amount_settled <= teacher_share
  IF NEW.amount_settled > v_ledger.teacher_share THEN
    RAISE EXCEPTION 'Amount settled % exceeds ledger entry teacher_share %',
      NEW.amount_settled, v_ledger.teacher_share;
  END IF;

  -- Amount integrity: cumulative SUM <= payout.amount
  SELECT COALESCE(SUM(amount_settled), 0) INTO v_cumulative
  FROM public.teacher_payout_ledger_entries
  WHERE payout_id = NEW.payout_id;

  IF v_cumulative + NEW.amount_settled > v_payout.amount THEN
    RAISE EXCEPTION 'Cumulative amount settled % + new % = % exceeds payout amount %',
      v_cumulative, NEW.amount_settled, v_cumulative + NEW.amount_settled, v_payout.amount;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_payout_ledger_integrity ON public.teacher_payout_ledger_entries;
CREATE TRIGGER trg_check_payout_ledger_integrity
  BEFORE INSERT ON public.teacher_payout_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.check_payout_ledger_integrity();

-- =============================================================
-- TRIGGER C: protect_payout_immutability()
--   BEFORE UPDATE on teacher_payouts
--
--   Enforces:
--     - Snapshot columns ALWAYS immutable (from INSERT, not just after 'pending')
--     - Amount ALWAYS immutable (from INSERT, no edit workflow)
--     - Status transitions follow lifecycle rules
--     - Completion requires SUM(linked) = payout.amount
-- =============================================================

CREATE OR REPLACE FUNCTION public.protect_payout_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked NUMERIC(12,2);
BEGIN
  -- Snapshot columns ALWAYS immutable (not just after status leaves 'pending')
  IF NEW.payout_method_type != OLD.payout_method_type
     OR NEW.payout_method_display_label != OLD.payout_method_display_label
     OR NEW.payout_method_masked != OLD.payout_method_masked THEN
    RAISE EXCEPTION 'Snapshot fields are immutable after payout creation';
  END IF;

  -- Amount ALWAYS immutable (no payout-edit workflow)
  IF NEW.amount != OLD.amount THEN
    RAISE EXCEPTION 'Amount is immutable after payout creation';
  END IF;

  -- Status transition validation
  IF NEW.status != OLD.status THEN
    IF OLD.status = 'pending' AND NEW.status NOT IN ('processing', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid status transition: pending → % (allowed: processing, cancelled)',
        NEW.status;
    ELSIF OLD.status = 'processing' AND NEW.status NOT IN ('completed', 'failed') THEN
      RAISE EXCEPTION 'Invalid status transition: processing → % (allowed: completed, failed)',
        NEW.status;
    ELSIF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'Invalid status transition: completed is terminal — cannot transition to %',
        NEW.status;
    ELSIF OLD.status = 'failed' AND NEW.status != 'pending' THEN
      RAISE EXCEPTION 'Invalid status transition: failed → % (allowed: pending for retry)',
        NEW.status;
    ELSIF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'Invalid status transition: cancelled is terminal — cannot transition to %',
        NEW.status;
    END IF;
  END IF;

  -- Completion integrity: SUM(linked amount_settled) = payout.amount
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    SELECT COALESCE(SUM(amount_settled), 0) INTO v_linked
    FROM public.teacher_payout_ledger_entries
    WHERE payout_id = NEW.id;

    IF v_linked != NEW.amount THEN
      RAISE EXCEPTION 'Cannot complete payout: linked amount % does not exactly equal payout amount % (full settlement required)',
        v_linked, NEW.amount;
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payout_immutability ON public.teacher_payouts;
CREATE TRIGGER trg_protect_payout_immutability
  BEFORE UPDATE ON public.teacher_payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_payout_immutability();

-- -------------------------------------------------------------
-- GRANT/REVOKE on trigger functions
--   REVOKE FROM PUBLIC (PostgreSQL default for SECURITY DEFINER)
--   GRANT TO service_role only
-- -------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.check_payout_method_ownership() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_payout_method_ownership() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_payout_method_ownership() TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_payout_ledger_integrity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_payout_ledger_integrity() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_payout_ledger_integrity() TO service_role;

REVOKE EXECUTE ON FUNCTION public.protect_payout_immutability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_payout_immutability() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_payout_immutability() TO service_role;

-- -------------------------------------------------------------
-- RLS Policies
-- -------------------------------------------------------------

ALTER TABLE public.teacher_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tp_teacher_read ON public.teacher_payouts;
CREATE POLICY tp_teacher_read
  ON public.teacher_payouts FOR SELECT
  USING (teacher_id = auth.uid());

ALTER TABLE public.teacher_payout_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tple_teacher_read ON public.teacher_payout_ledger_entries;
CREATE POLICY tple_teacher_read
  ON public.teacher_payout_ledger_entries FOR SELECT
  USING (teacher_id = auth.uid());

ALTER TABLE public.teacher_payout_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tpal_teacher_read ON public.teacher_payout_audit_log;
CREATE POLICY tpal_teacher_read
  ON public.teacher_payout_audit_log FOR SELECT
  USING (teacher_id = auth.uid());

-- Done.
