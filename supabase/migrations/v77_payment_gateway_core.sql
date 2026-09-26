-- =============================================================
-- v77_payment_gateway_core.sql
-- AttenDo LMS — Payment Gateway Core Architecture
--
-- This migration creates the database foundation for the dynamic
-- payment gateway abstraction layer. It is provider-agnostic —
-- no Paymob, Fawry, or any other provider-specific columns exist.
--
-- Key design decisions:
--   1. Credentials are stored encrypted (AES-256-GCM) — the
--      encryption key lives in the application environment, NOT
--      in the database.
--   2. Only 0 or 1 default gateway can exist at a time (enforced
--      by a partial unique index).
--   3. A gateway can be 'enabled' but in 'sandbox' — these are
--      orthogonal concepts.
--   4. RLS blocks all client access — only the service role
--      (bypasses RLS) can read/write gateway configs.
--   5. An audit log tracks gateway management events (no secrets
--      in the log).
--
-- This migration does NOT:
--   - Delete or modify orders, payments, or subject_students.
--   - Modify the activate_subscription_after_payment RPC.
--   - Change any pricing or subscription logic.
--   - Add any provider-specific columns.
-- =============================================================

-- -------------------------------------------------------------
-- 1. payment_gateways table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_gateways (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL,                    -- 'paymob', 'fawry', etc.
  display_name            TEXT NOT NULL,                    -- human-readable name
  environment             TEXT NOT NULL DEFAULT 'sandbox'
                            CHECK (environment IN ('sandbox', 'live')),
  is_enabled              BOOLEAN NOT NULL DEFAULT false,
  is_default              BOOLEAN NOT NULL DEFAULT false,
  credentials_encrypted   TEXT,                             -- AES-256-GCM encrypted JSON
  configuration_encrypted TEXT,                             -- non-credential config (webhook URL, etc.)
  capabilities            JSONB,                             -- cached capability snapshot
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One config per provider per environment
  UNIQUE(provider, environment)
);

-- Only one default gateway can exist at a time (across ALL providers + environments)
CREATE UNIQUE INDEX IF NOT EXISTS payment_gateways_one_default
  ON public.payment_gateways(is_default)
  WHERE is_default = true;

-- Enable RLS — only service role can access (bypasses RLS)
ALTER TABLE public.payment_gateways ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies — only the service role
-- (which bypasses RLS) can access this table.

-- -------------------------------------------------------------
-- 2. payment_gateway_audit_log table
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_gateway_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id   UUID REFERENCES public.payment_gateways(id) ON DELETE CASCADE,
  event        TEXT NOT NULL CHECK (event IN (
    'gateway.created',
    'gateway.updated',
    'gateway.enabled',
    'gateway.disabled',
    'gateway.default_changed',
    'gateway.connection_tested'
  )),
  actor_id     UUID,        -- the user who performed the action (nullable for system events)
  details      JSONB,       -- non-secret context — NEVER store credentials here
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_gateway
  ON public.payment_gateway_audit_log(gateway_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_audit_event
  ON public.payment_gateway_audit_log(event, created_at);

ALTER TABLE public.payment_gateway_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies — service role only.

-- -------------------------------------------------------------
-- 3. Add gateway_id column to orders (nullable — links an order
--    to the gateway that was used for payment).
--    Historical orders have NULL (no gateway was used).
--    New orders created via PaymentService will have this set.
-- -------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS gateway_id UUID REFERENCES public.payment_gateways(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_gateway
  ON public.orders(gateway_id)
  WHERE gateway_id IS NOT NULL;

-- Done. The database is now ready for the Payment Gateway Core.
-- Verify with:
--   \d public.payment_gateways
--   \d public.payment_gateway_audit_log
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'gateway_id';
