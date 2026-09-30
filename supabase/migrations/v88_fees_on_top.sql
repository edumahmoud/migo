-- =====================================================
-- v88: Fees-on-top model — platform commission + tax + custom fees
-- =====================================================
-- GOAL: switch from "deduct-from-gross" semantics (the current model,
-- where the platform takes its commission from the subscription total
-- and the teacher gets the rest) to "fees-on-top" semantics (the
-- student pays: subscriptions_total + commission + tax + other fees
-- = grand_total. The teacher keeps their subscription total minus
-- platform commission. Tax + other fees stay with the platform).
--
-- New tables:
--   - fee_catalog   — admin-defined fee types (commission, tax, custom)
--   - order_fees    — per-order snapshot of fees applied at checkout
-- New columns on orders:
--   - base_amount   NUMERIC(12,2) — sum of subject prices (was = amount)
--   - fees_total    NUMERIC(12,2) — sum of all fee amounts
--   - grand_total   NUMERIC(12,2) — base_amount + fees_total (sent to Paymob)
-- New columns on financial_ledger:
--   - subscription_total   NUMERIC(12,2)
--   - tax_amount           NUMERIC(12,2)
--   - other_fees_amount    NUMERIC(12,2)
--   - fees_breakdown       JSONB
--
-- BACKFILL: existing rows keep their numbers intact. Old orders:
--   base_amount = amount, fees_total = 0, grand_total = amount.
-- Old ledger rows: subscription_total = gross_amount, tax = 0, other = 0,
--   fees_breakdown = '[]'.
-- Existing commission_rates table stays (used by old ledger snapshots).
-- The new fee_catalog supersedes it for new orders.
-- =====================================================

-- ───────────────────────────────────────────────────────
-- fee_catalog — admin-defined fee types
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_catalog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,             -- 'platform_commission' | 'tax' | 'processing_fee' | custom slug
  name_ar         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description     TEXT,
  fee_kind        TEXT NOT NULL CHECK (fee_kind IN ('percentage','flat')),
  value           NUMERIC(12,4) NOT NULL CHECK (value >= 0),
  -- percentage: 0-100 ; flat: EGP amount
  is_active       BOOLEAN NOT NULL DEFAULT true,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_catalog ENABLE ROW LEVEL SECURITY;
-- Only service role can read/write (admin via requireAdmin gate at API level).
-- Students/teachers can't query this table directly.

COMMENT ON TABLE public.fee_catalog IS
  'Admin-defined fees added on top of subscription base price. Each fee has a code (platform_commission, tax, processing_fee, custom), a kind (percentage|flat), and a value. Active fees are snapshotted into order_fees at checkout time.';

-- ───────────────────────────────────────────────────────
-- order_fees — per-order snapshot of fees applied at checkout
-- ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  fee_catalog_id  UUID,                              -- nullable in case catalog row is later deleted
  code            TEXT NOT NULL,                       -- SNAPSHOT of fee_catalog.code
  name_ar         TEXT NOT NULL,                       -- SNAPSHOT
  name_en         TEXT NOT NULL,                       -- SNAPSHOT
  fee_kind        TEXT NOT NULL,                       -- SNAPSHOT ('percentage' | 'flat')
  value           NUMERIC(12,4) NOT NULL,              -- SNAPSHOT
  base_amount     NUMERIC(12,2) NOT NULL,              -- the basis this fee was computed from
  calculated_amount NUMERIC(12,2) NOT NULL,            -- the actual EGP amount added
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_fees_order ON public.order_fees(order_id);

ALTER TABLE public.order_fees ENABLE ROW LEVEL SECURITY;
-- Students can SELECT their own order_fees (via join with orders RLS)
-- Only service role can INSERT/UPDATE/DELETE.

COMMENT ON TABLE public.order_fees IS
  'Snapshot of fees applied to an order at checkout. Each row records the fee code, name, kind (percentage|flat), value, base_amount (basis for computation), calculated_amount (EGP added to total). Immutable after creation — admin changes to fee_catalog don\'t retroactively affect existing orders.';

-- ───────────────────────────────────────────────────────
-- orders: add base_amount, fees_total, grand_total
-- ───────────────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS base_amount   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fees_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total   NUMERIC(12,2);

-- Backfill existing orders: under the old model, amount = base + 0 fees
UPDATE public.orders
  SET base_amount = amount,
      fees_total = 0,
      grand_total = amount
WHERE base_amount IS NULL;

-- Now make base_amount NOT NULL (all existing rows have it)
ALTER TABLE public.orders
  ALTER COLUMN base_amount SET NOT NULL,
  ALTER COLUMN grand_total SET NOT NULL;

COMMENT ON COLUMN public.orders.base_amount IS
  'Sum of subject prices for this order (was implicit in amount before v88). For multi-subject sessions, this is the sum of all member subjects.';
COMMENT ON COLUMN public.orders.fees_total IS
  'Sum of all fees (commission + tax + other) applied at checkout. = SUM(order_fees.calculated_amount).';
COMMENT ON COLUMN public.orders.grand_total IS
  'base_amount + fees_total. This is the amount sent to Paymob and validated by the webhook.';

-- ───────────────────────────────────────────────────────
-- financial_ledger: add breakdown columns
-- ───────────────────────────────────────────────────────
ALTER TABLE public.financial_ledger
  ADD COLUMN IF NOT EXISTS subscription_total   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_fees_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees_breakdown       JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill existing ledger rows
UPDATE public.financial_ledger
  SET subscription_total = gross_amount
WHERE subscription_total IS NULL;

ALTER TABLE public.financial_ledger
  ALTER COLUMN subscription_total SET NOT NULL;

COMMENT ON COLUMN public.financial_ledger.subscription_total IS
  'Sum of subject prices for the linked order. Under the new fees-on-top model, this is what the teacher is entitled to (before platform commission).';
COMMENT ON COLUMN public.financial_ledger.tax_amount IS
  'Sum of tax fees (e.g., VAT) collected on this payment. Stays with the platform (remitted to government).';
COMMENT ON COLUMN public.financial_ledger.other_fees_amount IS
  'Sum of other fees (e.g., processing fee). Stays with the platform.';
COMMENT ON COLUMN public.financial_ledger.fees_breakdown IS
  'JSONB array of fees applied: [{code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount}, ...]. Snapshot for audit/receipts.';

-- ───────────────────────────────────────────────────────
-- Seed fee_catalog from the existing active commission_rates row
-- (so new orders immediately continue using the same commission rate)
-- ───────────────────────────────────────────────────────
INSERT INTO public.fee_catalog (code, name_ar, name_en, description, fee_kind, value, is_active, sort_order)
SELECT
  'platform_commission' AS code,
  'عمولة المنصة' AS name_ar,
  'Platform Commission' AS name_en,
  'Platform commission percentage added on top of the subscription total.' AS description,
  'percentage' AS fee_kind,
  rate_percentage AS value,
  is_active,
  0 AS sort_order
FROM public.commission_rates
WHERE is_active = true
ON CONFLICT (code) DO NOTHING;

-- If no active commission rate exists, seed a default 0% commission
INSERT INTO public.fee_catalog (code, name_ar, name_en, description, fee_kind, value, is_active, sort_order)
VALUES (
  'platform_commission',
  'عمولة المنصة',
  'Platform Commission',
  'Platform commission percentage added on top of the subscription total.',
  'percentage',
  0,
  true,
  0
)
ON CONFLICT (code) DO NOTHING;

-- ───────────────────────────────────────────────────────
-- Done.
-- ───────────────────────────────────────────────────────
-- Verify:
--   SELECT * FROM public.fee_catalog;
--   SELECT base_amount, fees_total, grand_total FROM public.orders LIMIT 5;
--   SELECT subscription_total, tax_amount, other_fees_amount, fees_breakdown
--   FROM public.financial_ledger LIMIT 5;
