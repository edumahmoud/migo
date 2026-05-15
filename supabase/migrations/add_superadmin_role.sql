-- =====================================================
-- Migration: Add superadmin role and first-user logic
-- Run this SQL on existing Supabase databases
-- =====================================================

-- 1. Update the CHECK constraint to include 'superadmin'
ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'teacher', 'admin', 'superadmin'));

-- 2. Update the handle_new_user trigger to make first user superadmin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
BEGIN
  -- Count existing users to check if this is the first user
  SELECT COUNT(*) INTO user_count FROM public.users;
  
  -- First user becomes superadmin, all others get their specified role (default: student)
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    CASE 
      WHEN user_count = 0 THEN 'superadmin'
      ELSE COALESCE(NEW.raw_user_meta_data->>'role', 'student')
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Promote the first registered user to superadmin (if no superadmin exists)
-- This finds the earliest created user and makes them the platform owner
DO $$
DECLARE
  first_user_id UUID;
  superadmin_count integer;
BEGIN
  SELECT COUNT(*) INTO superadmin_count FROM public.users WHERE role = 'superadmin';
  
  IF superadmin_count = 0 THEN
    SELECT id INTO first_user_id FROM public.users ORDER BY created_at ASC LIMIT 1;
    
    IF first_user_id IS NOT NULL THEN
      UPDATE public.users SET role = 'superadmin', updated_at = NOW() WHERE id = first_user_id;
      RAISE NOTICE 'Promoted first user % to superadmin', first_user_id;
    END IF;
  END IF;
END $$;
