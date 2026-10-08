-- =====================================================
-- v110: Universal code login — student_code for ALL account types
-- =====================================================
-- Changes:
-- 1. Update generate_student_code() trigger to generate codes for
--    ALL users (not just students). The student_code field is now
--    used as a universal login code for all account types.
-- 2. Backfill existing non-student users who don't have a student_code.
-- =====================================================

-- 1. Update the trigger function to generate codes for ALL roles
CREATE OR REPLACE FUNCTION public.generate_student_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
BEGIN
  -- v110: Generate a code for ANY user who doesn't have one
  -- (previously only students got a code)
  IF NEW.student_code IS NULL THEN
    new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    WHILE EXISTS (SELECT 1 FROM public.users WHERE student_code = new_code) LOOP
      new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    END LOOP;
    NEW.student_code := new_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Backfill existing users without a student_code
-- This generates a unique 8-char code for every user who doesn't have one
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE student_code IS NULL LOOP
    LOOP
      new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE student_code = new_code);
    END LOOP;
    UPDATE public.users SET student_code = new_code WHERE id = r.id;
  END LOOP;
END $$;

-- 3. Set NOT NULL constraint (now that all users have a code)
ALTER TABLE public.users ALTER COLUMN student_code SET NOT NULL;

COMMENT ON COLUMN public.users.student_code IS
  'v110: Universal login code for ALL account types (student, teacher, admin, agent). Used as the primary login identifier (in addition to email).';

-- Done.