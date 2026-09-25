-- =============================================================
-- v73_phone_otp_verification.sql
-- AttenDo LMS — Phone verification via Telegram OTP.
--
-- Adds:
--   1. users.phone (TEXT, nullable for backward compat)
--   2. users.phone_verified (BOOLEAN DEFAULT FALSE)
--   3. otp_codes table (hashed OTP + expiry + retry + rate limit)
--   4. account_status CHECK widened with 'pending_verification'
--   5. Updated handle_new_user() for self-registered + phone
-- =============================================================

-- 1. users.phone + phone_verified
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Widen account_status CHECK
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('pending_verification', 'pending', 'active', 'suspended'));

-- 3. otp_codes table
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone             TEXT NOT NULL,
  code_hash         TEXT NOT NULL,     -- scrypt hash (never store plaintext)
  code_salt         TEXT NOT NULL,     -- per-code random salt
  expires_at        TIMESTAMPTZ NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 5,
  used              BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id  BIGINT,           -- Telegram chat ID for delivery
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user ON public.otp_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON public.otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON public.otp_codes(expires_at);

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
-- Students can only see their own OTP rows (for verification status).
DROP POLICY IF EXISTS otp_student_read ON public.otp_codes;
CREATE POLICY otp_student_read
  ON public.otp_codes FOR SELECT
  USING (user_id = auth.uid());
-- Service role manages all (INSERT, UPDATE, DELETE).
DROP POLICY IF EXISTS otp_admin_all ON public.otp_codes;
CREATE POLICY otp_admin_all
  ON public.otp_codes FOR ALL
  USING (public.is_admin());

-- 4. Updated handle_new_user() — sets 'pending_verification' for
--    self-registered students with a phone number.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
  insert_role text;
  user_name text;
  is_self_registered boolean;
  new_account_status text;
  user_phone text;
BEGIN
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  is_self_registered := COALESCE((NEW.raw_user_meta_data->>'self_registered')::boolean, false);
  user_phone := NEW.raw_user_meta_data->>'phone';

  SELECT COUNT(*) INTO user_count FROM public.users;

  IF user_count = 0 THEN
    insert_role := 'superadmin';
    new_account_status := 'active';
  ELSE
    insert_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
    IF insert_role = 'student' AND is_self_registered AND user_phone IS NOT NULL AND user_phone != '' THEN
      new_account_status := 'pending_verification';
    ELSIF insert_role = 'student' AND is_self_registered THEN
      new_account_status := 'pending';
    ELSE
      new_account_status := 'active';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.users (id, email, name, role, account_status, phone)
    VALUES (NEW.id, NEW.email, user_name, insert_role, new_account_status, user_phone);
    RETURN NEW;
  EXCEPTION
    WHEN check_violation THEN
      IF insert_role = 'superadmin' THEN
        INSERT INTO public.users (id, email, name, role, account_status, phone)
        VALUES (NEW.id, NEW.email, user_name, 'admin', 'active', user_phone);
      ELSE
        INSERT INTO public.users (id, email, name, role, account_status, phone)
        VALUES (NEW.id, NEW.email, user_name, 'student', new_account_status, user_phone);
      END IF;
      RETURN NEW;
    WHEN unique_violation THEN
      RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Realtime
ALTER PUBLICATION supabase_realtime SET TABLE public.otp_codes;
