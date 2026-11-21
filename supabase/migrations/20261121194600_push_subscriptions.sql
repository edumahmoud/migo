-- push_subscriptions table + RLS.
-- Extracted from the /api/push/setup route (audit #1) so the schema lives in
-- version control and the route no longer needs to execute DDL at runtime.
-- Apply in the Supabase SQL editor or via `supabase db push`.
--
-- Fully idempotent: safe to run on the production DB whether the table
-- already exists (from COMPLETE_SCHEMA.sql, v90, or the old setup route)
-- or not. Column definition matches COMPLETE_SCHEMA.sql exactly.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(endpoint)
);

-- Index for fast user lookup (no-op if already present)
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

-- Enable RLS (no-op if already enabled)
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies: users can read/insert/delete ONLY their own subscriptions.
-- DROP IF EXISTS first so this script never errors on re-run, regardless of
-- which older migration created policies. All server writes (subscribe /
-- unsubscribe / send) go through the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Users can read own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read own push subscriptions" ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can insert own push subscriptions" ON public.push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete own push subscriptions" ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

-- Remove the overly-broad legacy policy if the old /api/push/setup route
-- ever created it: FOR ALL USING (true) would let any authenticated user
-- read/modify EVERY subscription. The service role does not need it (it
-- bypasses RLS entirely).
DROP POLICY IF EXISTS "Service role full access" ON public.push_subscriptions;

-- Auto-update updated_at trigger (same body as v19/COMPLETE_SCHEMA)
CREATE OR REPLACE FUNCTION public.update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_push_subscriptions_updated_at();
