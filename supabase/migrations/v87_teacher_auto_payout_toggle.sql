-- =====================================================
-- v87: Per-teacher auto-payout toggle
-- =====================================================
-- Adds a per-teacher boolean `auto_payout_enabled` to the users
-- table. When TRUE (and PAYMOB_DISBURSEMENT_API_KEY env var is set),
-- the manual settle endpoint will route through the Paymob
-- Disbursement adapter — i.e., it transfers REAL money to the
-- teacher's wallet/bank via Paymob instead of just recording a
-- manual settlement in the DB.
--
-- When FALSE (the default), the settle endpoint uses the existing
-- manual flow (status-only DB update, no real money transfer).
--
-- The platform-wide kill switch is `AUTO_PAYOUT_FEATURE_ENABLED`
-- (env var). If FALSE, the per-teacher flag is ignored — the
-- system falls back to manual settlement for everyone.
--
-- Default: FALSE (safe — requires explicit opt-in per teacher).
-- =====================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auto_payout_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.auto_payout_enabled IS
  'Per-teacher flag. When TRUE + PAYMOB_DISBURSEMENT_API_KEY env var is set + AUTO_PAYOUT_FEATURE_ENABLED=true, manual settle routes through Paymob disbursement (real money transfer). Default FALSE.';

-- ───────────────────────────────────────────────────────
-- Index for the bulk-toggle query (filter teachers with
-- pending payouts to settle)
-- ───────────────────────────────────────────────────────
-- Already covered by the existing idx on users(role) —
-- the bulk toggle uses .eq('role', 'teacher') + a JOIN to
-- financial_ledger for pending totals. No additional index.

-- Done.
