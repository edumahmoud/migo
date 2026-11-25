-- v142: Android system push (FCM) for every notification.
-- Rollback at the bottom of this file (commented).

-- 1. Device tokens (one row per installed app; token is unique, user can change)
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
-- No client policies: only the server (service role) reads/writes tokens.

-- 2. Private config (dispatch URL + shared secret). Never exposed to clients.
CREATE TABLE IF NOT EXISTS public.push_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_config FROM anon, authenticated;

-- 3. Trigger: every new notification row asks the server to push it.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_push_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  -- Announcement rows are broadcast by the server through an FCM topic instead.
  IF NEW.link IS NOT NULL AND NEW.link LIKE 'announcement:%' THEN
    RETURN NEW;
  END IF;
  SELECT value INTO v_url FROM public.push_config WHERE key = 'dispatch_url';
  SELECT value INTO v_secret FROM public.push_config WHERE key = 'dispatch_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the notification insert because push failed.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_push ON public.notifications;
CREATE TRIGGER trg_notifications_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_dispatch();

-- ROLLBACK:
-- DROP TRIGGER IF EXISTS trg_notifications_push ON public.notifications;
-- DROP FUNCTION IF EXISTS public.notify_push_dispatch();
-- DROP TABLE IF EXISTS public.push_config;
-- DROP TABLE IF EXISTS public.device_tokens;
