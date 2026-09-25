-- =============================================================
-- reapply_v73_phone_otp_verification.sql
-- =============================================================
-- AttenDo LMS — One-shot re-apply of the v73 phone-OTP migration.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor) when:
--   - New students skip the OTP page on signup, OR
--   - GET /api/setup/check-otp-migration returns a verdict other than
--     "v73_FULLY_applied", OR
--   - The v73 migration file was edited locally and the changes need to
--     be propagated to the live database.
--
-- This script is IDEMPOTENT — safe to run multiple times.
-- =============================================================

-- 1. Add phone + phone_verified columns
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Widen the account_status CHECK constraint to allow 'pending_verification'.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('pending_verification', 'pending', 'active', 'suspended'));

-- 3. Create the otp_codes table (if missing).
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
CREATE INDEX IF NOT EXISTS idx_otp_codes_user  ON public.otp_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON public.otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON public.otp_codes(expires_at);

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS otp_student_read ON public.otp_codes;
CREATE POLICY otp_student_read
  ON public.otp_codes FOR SELECT
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS otp_admin_all ON public.otp_codes;
CREATE POLICY otp_admin_all
  ON public.otp_codes FOR ALL
  USING (public.is_admin());

-- 4. Recreate the handle_new_user() function with the v73 logic.
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
      -- Fallback: 'pending_verification' not allowed (CHECK widening
      -- didn't take). Use 'pending' — the frontend + APIs will still
      -- route the user to the OTP page based on phone + phone_verified.
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

-- 5. Re-bind the trigger. DROP+CREATE guarantees the trigger invokes
--    the function body we just defined above (no cached OID issues).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Realtime.
ALTER PUBLICATION supabase_realtime SET TABLE public.otp_codes;

-- =============================================================
-- Backfill: existing users who have a phone in auth metadata but
-- NULL in the DB column. Run ONCE after the columns exist.
-- =============================================================
-- Note: this can't reference auth.users from public schema RLS, so we
-- do it via a SECURITY DEFINER function that reads auth.users metadata.
CREATE OR REPLACE FUNCTION public.backfill_user_phones()
RETURNS void AS $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN SELECT id, raw_user_meta_data FROM auth.users WHERE raw_user_meta_data ? 'phone' LOOP
    UPDATE public.users
    SET phone = COALESCE(phone, u.raw_user_meta_data->>'phone')
    WHERE id = u.id AND phone IS NULL;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT public.backfill_user_phones();

-- Also: if any users are stuck in 'pending' with a phone set + phone_verified=false
-- (the degraded state from a partial v73 apply), promote them to 'pending_verification'
-- now that the CHECK allows it.
UPDATE public.users
SET account_status = 'pending_verification', updated_at = now()
WHERE account_status = 'pending'
  AND phone IS NOT NULL
  AND phone_verified = false;

-- Done. Verify with:
-- SELECT account_status, COUNT(*) FROM public.users GROUP BY account_status;
-- SELECT id, phone, phone_verified, account_status FROM public.users WHERE phone IS NOT NULL LIMIT 5;
