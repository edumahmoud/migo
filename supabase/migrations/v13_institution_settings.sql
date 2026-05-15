-- ============================================
-- Institution Settings Table + Setup RPC
-- ============================================
-- This migration creates:
-- 1. institution_settings table for storing institution data
-- 2. setup_initialize_system() RPC function for creating the table + inserting data in one call

-- ─── 1. Create institution_settings table ───
CREATE TABLE IF NOT EXISTS institution_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_en TEXT,
  type TEXT NOT NULL CHECK (type IN ('center', 'school', 'university')),
  logo_url TEXT,
  country TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  academic_year TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE institution_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read
DO $$ BEGIN
  CREATE POLICY "Anyone can read institution_settings" ON institution_settings
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow service role to insert (setup wizard)
DO $$ BEGIN
  CREATE POLICY "Service can insert institution_settings" ON institution_settings
    FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow service role to update
DO $$ BEGIN
  CREATE POLICY "Service can update institution_settings" ON institution_settings
    FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_institution_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_institution_updated_at ON institution_settings;
CREATE TRIGGER trg_institution_updated_at
  BEFORE UPDATE ON institution_settings
  FOR EACH ROW EXECUTE FUNCTION update_institution_updated_at();

-- ─── 2. Create RPC function for setup wizard ───
-- This function allows the setup API to insert institution data
-- using the service role key via supabase.rpc()
CREATE OR REPLACE FUNCTION setup_initialize_system(
  p_name TEXT,
  p_name_en TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'center',
  p_logo_url TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_academic_year TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
  v_existing_id UUID;
BEGIN
  -- Check if already initialized
  SELECT id INTO v_existing_id FROM institution_settings LIMIT 1;
  
  IF v_existing_id IS NOT NULL THEN
    -- Update existing
    UPDATE institution_settings SET
      name = p_name,
      name_en = p_name_en,
      type = p_type,
      logo_url = p_logo_url,
      country = p_country,
      city = p_city,
      address = p_address,
      phone = p_phone,
      email = p_email,
      website = p_website,
      academic_year = p_academic_year,
      description = p_description
    WHERE id = v_existing_id;
    
    RETURN json_build_object('action', 'updated', 'id', v_existing_id);
  END IF;
  
  -- Insert new
  INSERT INTO institution_settings (name, name_en, type, logo_url, country, city, address, phone, email, website, academic_year, description)
  VALUES (p_name, p_name_en, p_type, p_logo_url, p_country, p_city, p_address, p_phone, p_email, p_website, p_academic_year, p_description)
  RETURNING id INTO v_id;
  
  RETURN json_build_object('action', 'created', 'id', v_id);
END;
$$;
