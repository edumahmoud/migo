-- =====================================================
-- v90: push_subscriptions table (migration, was previously
-- only in COMPLETE_SCHEMA.sql)
-- =====================================================
-- The push_subscriptions table stores per-user push notification
-- subscriptions. Each row = one device the user has subscribed
-- from (browser + service worker + VAPID keys).
-- The web-push library uses this to send push messages outside
-- the browser tab (mobile push on Android Chrome + desktop + iOS
-- 16.4+ Safari when the app is installed as PWA).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,        -- the FCM/APN endpoint URL the push service gave us
  p256dh      TEXT,                          -- base64-encoded public key (ECDH)
  auth_key    TEXT,                          -- base64-encoded auth secret
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

-- RLS: users can only see their own subscriptions
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_sub_user_select ON public.push_subscriptions;
CREATE POLICY push_sub_user_select
  ON public.push_subscriptions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_sub_user_insert ON public.push_subscriptions;
CREATE POLICY push_sub_user_insert
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_sub_user_delete ON public.push_subscriptions;
CREATE POLICY push_sub_user_delete
  ON public.push_subscriptions FOR DELETE
  USING (user_id = auth.uid());

-- Note: UPDATE is intentionally NOT granted via RLS — the server
-- (service role) is the only writer of updated_at. Client code uses
-- INSERT (with ON CONFLICT) instead of UPDATE for upsert.

COMMENT ON TABLE public.push_subscriptions IS
  'Per-user push notification subscriptions (one row per device). Used by web-push to deliver push messages outside the browser tab. RLS: users see/insert/delete their own only.';
