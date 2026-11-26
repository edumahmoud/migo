-- v154: storage plan subscription prices (code already reads/writes these; prod lacked them).
-- Additive. price_yearly NULL means yearly is not offered for that plan.
ALTER TABLE public.storage_plans ADD COLUMN IF NOT EXISTS price_monthly numeric;
ALTER TABLE public.storage_plans ADD COLUMN IF NOT EXISTS price_yearly numeric;
UPDATE public.storage_plans SET price_monthly = price WHERE price_monthly IS NULL;
ALTER TABLE public.user_storage_upgrades ADD COLUMN IF NOT EXISTS duration_type text NOT NULL DEFAULT 'monthly';
ALTER TABLE public.user_storage_upgrades ADD COLUMN IF NOT EXISTS expires_at timestamptz;
NOTIFY pgrst, 'reload schema';
