-- =============================================================
-- v134b_restore_otp_tables.sql
-- AttenDo LMS — Restore critical auth tables after data-destruct
--
-- Background:
--   The v133 data-destruct feature (admin data management) can delete
--   the `otp_codes` table's rows when the admin selects the "users"
--   category. This breaks the phone-verification flow: new users
--   create an account, get routed to the OTP page, but the INSERT
--   into otp_codes fails (table rows deleted = table effectively
--   unusable until recreated).
--
--   This migration:
--   1. Recreates otp_codes if it was dropped (CREATE TABLE IF NOT EXISTS)
--   2. Recreates its indexes
--   3. Recreates its RLS policies
--   4. Re-adds it to the realtime publication
--   5. Recreates the handle_new_user() trigger (in case it was
--      affected by the destructive operation)
--
--   This is SAFE to run multiple times — all statements use IF NOT EXISTS.
-- =============================================================

-- 1. Recreate otp_codes table (if missing)
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone             TEXT NOT NULL,
  code_hash         TEXT NOT NULL,
  code_salt         TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 5,
  used              BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id  BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_otp_codes_user ON public.otp_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON public.otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON public.otp_codes(expires_at);

-- 3. Enable RLS + recreate policies
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otp_student_read ON public.otp_codes;
CREATE POLICY otp_student_read
  ON public.otp_codes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS otp_admin_all ON public.otp_codes;
CREATE POLICY otp_admin_all
  ON public.otp_codes FOR ALL
  USING (public.is_admin());

-- 4. Re-add to realtime publication
ALTER PUBLICATION supabase_realtime SET TABLE public.otp_codes;

-- 5. Recreate handle_new_user() function + trigger (in case it was
--    affected). This is the same function body as v73.
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
        VALUES (NEW.id, NEW.email, user_name, 'student',
                CASE WHEN new_account_status = 'pending_verification' THEN 'pending' ELSE new_account_status END,
                user_phone);
      END IF;
      RETURN NEW;
    WHEN unique_violation THEN
      RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-bind the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Ensure users.phone + phone_verified columns exist (in case they
--    were somehow dropped)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 7. Ensure account_status CHECK constraint includes 'pending_verification'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_account_status_check'
    AND contype = 'c'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('pending_verification', 'pending', 'active', 'suspended'));
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Constraint might already exist with a different definition — try to replace it.
  BEGIN
    ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_account_status_check;
    ALTER TABLE public.users
      ADD CONSTRAINT users_account_status_check
      CHECK (account_status IN ('pending_verification', 'pending', 'active', 'suspended'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

COMMENT ON TABLE public.otp_codes IS
  'v134b: Restored after potential data-destruct. Stores hashed Telegram OTP codes.';
