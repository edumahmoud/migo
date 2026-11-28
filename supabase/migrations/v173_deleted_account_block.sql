-- v173: a deleted account keeps its email AND phone blocked from re-registering, but is listed apart from real bans.
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ban';
ALTER TABLE public.banned_users DROP CONSTRAINT IF EXISTS banned_users_source_check;
ALTER TABLE public.banned_users ADD CONSTRAINT banned_users_source_check CHECK (source IN ('ban','deleted'));
CREATE INDEX IF NOT EXISTS banned_users_phone_idx ON public.banned_users (phone) WHERE phone IS NOT NULL;
UPDATE public.banned_users SET source = 'deleted' WHERE reason = 'تم الحذف بواسطة المشرف' AND source = 'ban';
