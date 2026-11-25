-- v144: log of notifications sent from the admin "Send notification" screen, so admins can review and resend them.
-- Server-only table (service role); no client policies.
-- Rollback at the bottom (commented).

CREATE TABLE IF NOT EXISTS public.admin_notification_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  audience TEXT NOT NULL CHECK (audience IN ('all','teachers','students','admins','subject','users')),
  subject_id UUID,
  user_ids UUID[],
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  recipient_count INT NOT NULL DEFAULT 0,
  resent_from UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notification_log_created ON public.admin_notification_log(created_at DESC);
ALTER TABLE public.admin_notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_notification_log FROM anon, authenticated;

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.admin_notification_log;
