-- Banned users table: prevents re-registration after admin deletion
CREATE TABLE IF NOT EXISTS public.banned_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  banned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_banned_users_email ON public.banned_users(email);

ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage banned users" ON public.banned_users;
CREATE POLICY "Admins can manage banned users" ON public.banned_users
  FOR ALL USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.banned_users TO anon, authenticated;
