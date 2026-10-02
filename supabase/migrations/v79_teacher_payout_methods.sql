-- =============================================================
-- v79_teacher_payout_methods.sql
-- AttenDo LMS — Phase 11: Teacher Payout Methods
--
-- Creates:
--   1. teacher_payout_methods table — stores the teacher's
--      mobile wallet info (Vodafone Cash, Etisalat Cash,
--      Orange Cash, WE Cash). Sensitive fields are stored
--      AES-256-GCM encrypted; only a masked summary is
--      safe to return to the frontend.
--   2. teacher_payout_method_audit_log table — records
--      management events WITHOUT storing secrets.
--
-- Design principles (mirrored from v77_payment_gateway_core):
--   - Encryption key lives in app env (PAYMENT_CREDENTIALS_ENCRYPTION_KEY),
--     NEVER in the DB. Reuses src/lib/payment/crypto.ts.
--   - Only one default method per teacher (partial unique index).
--   - Teachers can soft-disable but NOT hard-delete their methods.
--   - RLS: teachers see + manage only their own rows.
--   - Audit log: secrets never logged. Only masked values.
--
-- Phase 11 scope:
--   - Storage + management UI only.
--   - NO actual transfer execution (deferred to Phase 13).
--   - NO bank_account, NO instapay, NO Fawry payout.
--   - NO link to financial_ledger (deferred to Phase 13).
-- =============================================================

-- -------------------------------------------------------------
-- 1. teacher_payout_methods table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_payout_methods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Snapshot FK to auth.users(id). No DB FK constraint:
  --   if a teacher is deleted from auth.users, the row should
  --   persist (for audit / historical purposes).
  teacher_id          UUID NOT NULL,
  -- Only mobile wallets in Phase 11. Adding new types requires
  -- updating the CHECK + adding a schema in payout-method-schemas.ts.
  method_type         TEXT NOT NULL CHECK (method_type IN (
    'vodafone_cash', 'etisalat_cash', 'orange_cash', 'we_cash'
  )),
  -- Human-readable label chosen by the teacher (e.g., "My Vodafone Wallet")
  display_label       TEXT NOT NULL,
  -- AES-256-GCM encrypted JSON blob (wallet_number, holder_name).
  -- Decryption happens ONLY inside the repository layer, never
  -- returned to any API response.
  details_encrypted   TEXT NOT NULL,
  -- Masked summary (last 4 digits only). Safe to return to frontend.
  -- Format: "**** **** 5678"
  details_masked      TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  is_default         BOOLEAN NOT NULL DEFAULT false,
  -- Verification: admin can mark a method as verified.
  -- Teacher cannot self-verify.
  verified_at         TIMESTAMPTZ,
  verified_by         UUID,  -- admin/superadmin user_id (nullable)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevent duplicate of same wallet for the same teacher.
  -- (Same masked value + same type + same teacher = duplicate.)
  UNIQUE(teacher_id, method_type, details_masked)
);

-- Only ONE default (active) method per teacher.
-- Mirrors the payment_gateways_one_default pattern from v77.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_payout_methods_one_default
  ON public.teacher_payout_methods(teacher_id)
  WHERE is_default = true AND is_active = true;

-- Fast lookup: list a teacher's active methods.
CREATE INDEX IF NOT EXISTS idx_teacher_payout_methods_teacher
  ON public.teacher_payout_methods(teacher_id) WHERE is_active = true;

-- -------------------------------------------------------------
-- 2. RLS: teacher_payout_methods
--   Teachers see + manage only their own rows.
--   Teachers CANNOT hard-delete (no DELETE policy).
--   Admins (service role) bypass RLS for verify/hard-delete.
-- -------------------------------------------------------------
ALTER TABLE public.teacher_payout_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpm_teacher_read ON public.teacher_payout_methods;
CREATE POLICY tpm_teacher_read
  ON public.teacher_payout_methods FOR SELECT
  USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS tpm_teacher_insert ON public.teacher_payout_methods;
CREATE POLICY tpm_teacher_insert
  ON public.teacher_payout_methods FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS tpm_teacher_update ON public.teacher_payout_methods;
CREATE POLICY tpm_teacher_update
  ON public.teacher_payout_methods FOR UPDATE
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- NO DELETE policy. Hard-delete is admin-only (service role
-- bypasses RLS). Teachers can only soft-disable (is_active=false).

-- -------------------------------------------------------------
-- 3. teacher_payout_method_audit_log table
--   Records management events WITHOUT storing secrets.
--   The `details` JSONB column may store: { masked: '**** 5678' }
--   NEVER the full wallet number, NEVER the encrypted blob.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_payout_method_audit_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_method_id    UUID NOT NULL REFERENCES public.teacher_payout_methods(id) ON DELETE CASCADE,
  teacher_id          UUID NOT NULL,
  event               TEXT NOT NULL CHECK (event IN (
    'payout_method.created',
    'payout_method.updated',
    'payout_method.set_default',
    'payout_method.disabled',
    'payout_method.reenabled',
    'payout_method.verified'
  )),
  actor_id            UUID,        -- the user who performed the action (nullable for system events)
  details             JSONB,       -- non-secret context only (e.g., { masked: '**** 5678' })
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_audit_method
  ON public.teacher_payout_method_audit_log(payout_method_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payout_audit_teacher
  ON public.teacher_payout_method_audit_log(teacher_id, created_at);

ALTER TABLE public.teacher_payout_method_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies — service role only. Teachers can read their own
-- audit history via a dedicated API endpoint (TODO Phase 12+ if needed),
-- which will filter by teacher_id = auth.user.id server-side.

-- Done. Verify with:
--   \d public.teacher_payout_methods
--   \d public.teacher_payout_method_audit_log
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('teacher_payout_methods', 'teacher_payout_method_audit_log');
