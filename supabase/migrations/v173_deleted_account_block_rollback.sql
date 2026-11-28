DROP INDEX IF EXISTS public.banned_users_phone_idx;
ALTER TABLE public.banned_users DROP CONSTRAINT IF EXISTS banned_users_source_check;
ALTER TABLE public.banned_users DROP COLUMN IF EXISTS source;
ALTER TABLE public.banned_users DROP COLUMN IF EXISTS phone;
