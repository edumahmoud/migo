-- =============================================================
-- v134q_storage_subscription.sql
-- AttenDo LMS — Storage plans become SUBSCRIPTIONS (v134q)
--
-- User requests:
--   1. Monthly subscription payment with restriction when the
--      month ends (quota reverts when the subscription expires).
--   2. Both monthly and yearly durations available.
--   3. Restrict subscribing to plans SMALLER than the current one.
--
-- Model change (was v134i):
--   storage_plans were PERMANENT ("buy X MB forever"). They are now
--   time-based subscriptions. Each plan carries TWO prices:
--     - price_monthly: what the user pays per month
--     - price_yearly : what the user pays per year (optional — NULL
--                      means the plan is not offered yearly)
--   The old `price` column is kept in sync (= price_monthly) for
--   backward compatibility with older readers.
--
--   user_storage_upgrades gains:
--     - duration_type: 'permanent' (legacy rows) | 'monthly' | 'yearly'
--     - expires_at   : NULL for legacy permanent upgrades, otherwise
--                      the moment the quota add-on stops applying.
--                      The storage check API auto-deactivates expired
--                      upgrades — that is the "restriction when the
--                      month ends".
--
-- Grandfathering: existing active upgrades (purchased under the
-- permanent model) keep duration_type='permanent' and expires_at=NULL
-- → they never expire. Only NEW approvals create time-limited rows.
-- =============================================================

-- 1. storage_plans: monthly + yearly prices.
ALTER TABLE public.storage_plans
  ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(10,2);

ALTER TABLE public.storage_plans
  ADD COLUMN IF NOT EXISTS price_yearly NUMERIC(10,2);

-- Backfill: monthly price = old permanent price; yearly = 10x monthly
-- (≈ 2 months free — the admin can edit anytime).
UPDATE public.storage_plans
SET price_monthly = price
WHERE price_monthly IS NULL;

UPDATE public.storage_plans
SET price_yearly = ROUND(price * 10, 2)
WHERE price_yearly IS NULL;

-- Keep the legacy `price` column aligned with the monthly price.
UPDATE public.storage_plans
SET price = price_monthly
WHERE price IS DISTINCT FROM price_monthly;

-- 2. user_storage_upgrades: duration + expiry.
ALTER TABLE public.user_storage_upgrades
  ADD COLUMN IF NOT EXISTS duration_type TEXT NOT NULL DEFAULT 'permanent';

ALTER TABLE public.user_storage_upgrades
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- CHECK constraint for valid duration values.
DO $$
BEGIN
  ALTER TABLE public.user_storage_upgrades
    DROP CONSTRAINT IF EXISTS chk_upgrade_duration_type;
  ALTER TABLE public.user_storage_upgrades
    ADD CONSTRAINT chk_upgrade_duration_type CHECK (
      duration_type IN ('permanent', 'monthly', 'yearly')
    );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Index for the expiry sweep performed by /api/storage/check.
CREATE INDEX IF NOT EXISTS idx_user_storage_upgrades_expiry
  ON public.user_storage_upgrades(expires_at)
  WHERE is_active = true AND expires_at IS NOT NULL;

-- 3. Verify.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('storage_plans', 'user_storage_upgrades')
  AND column_name IN ('price', 'price_monthly', 'price_yearly',
                      'duration_type', 'expires_at')
ORDER BY table_name, column_name;
