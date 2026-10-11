-- =============================================================
-- v134i_storage_plans.sql
-- AttenDo LMS — Google Drive-style storage plans
--
-- Model:
--   - Every user gets a default free storage quota (set by admin).
--   - When the quota is full, the user sees multiple upgrade plans
--     (like Google Drive: 50GB, 200GB, 2TB, etc.).
--   - Each plan has: size_mb + price + currency + name.
--   - The user picks a plan → submits a request → admin approves →
--     the user's storage quota increases to the plan's size.
--   - Plans are NOT time-based (no monthly/yearly). They're
--     "buy X MB for Y price" — permanent until the admin changes it.
--
-- Tables:
--   1. storage_plans — the available upgrade plans (admin-managed)
--   2. user_storage_upgrades — which plan each user has purchased
-- =============================================================

-- 1. storage_plans — upgrade plans
CREATE TABLE IF NOT EXISTS public.storage_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                    -- e.g. '50 جيجابايت'
  name_en     TEXT,                             -- e.g. '50 GB'
  size_mb     INTEGER NOT NULL,                 -- size in MB (e.g. 51200 = 50GB)
  price       NUMERIC(10,2) NOT NULL DEFAULT 0, -- price in the specified currency
  currency    TEXT NOT NULL DEFAULT 'EGP',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.storage_plans ENABLE ROW LEVEL SECURITY;

-- Anyone can read plans (needed to show them to users).
CREATE POLICY "Anyone can read storage_plans"
  ON public.storage_plans FOR SELECT USING (true);

-- 2. user_storage_upgrades — which plan each user purchased
CREATE TABLE IF NOT EXISTS public.user_storage_upgrades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL REFERENCES public.storage_plans(id) ON DELETE CASCADE,
  size_mb         INTEGER NOT NULL,             -- snapshot of plan's size at purchase time
  price           NUMERIC(10,2) NOT NULL,       -- snapshot of plan's price
  currency        TEXT NOT NULL DEFAULT 'EGP',
  request_id      UUID,                         -- link to section_activation_requests
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_storage_upgrades_user
  ON public.user_storage_upgrades(user_id) WHERE is_active = true;

ALTER TABLE public.user_storage_upgrades ENABLE ROW LEVEL SECURITY;

-- Users can read their own upgrades.
CREATE POLICY "Users read own storage upgrades"
  ON public.user_storage_upgrades FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- 3. Seed default plans (like Google Drive)
INSERT INTO public.storage_plans (name, name_en, size_mb, price, currency, sort_order) VALUES
  ('50 جيجابايت', '50 GB', 51200, 20, 'EGP', 1),
  ('200 جيجابايت', '200 GB', 204800, 50, 'EGP', 2),
  ('500 جيجابايت', '500 GB', 512000, 100, 'EGP', 3),
  ('2 تيرابايت', '2 TB', 2097152, 200, 'EGP', 4)
ON CONFLICT DO NOTHING;

-- 4. Ensure the files section config has default free quotas
-- (already done in v134h, but re-ensure here)
UPDATE public.locked_sections_config
SET student_monthly_limit = COALESCE(student_monthly_limit, 100),
    student_yearly_limit = COALESCE(student_yearly_limit, 100),
    teacher_monthly_limit = COALESCE(teacher_monthly_limit, 500),
    teacher_yearly_limit = COALESCE(teacher_yearly_limit, 500),
    student_locked = false,
    teacher_locked = false
WHERE section_key = 'files';

-- 5. Verify
SELECT id, name, name_en, size_mb, price, currency, is_active, sort_order
FROM public.storage_plans
ORDER BY sort_order;
