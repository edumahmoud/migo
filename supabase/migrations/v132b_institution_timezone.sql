-- =============================================================
-- v132b_institution_timezone.sql
-- AttenDo LMS — Add timezone column to institution_settings
--
-- Background:
--   The /api/setup endpoint sends `timezone` as part of the
--   institution update, but neither v13 (which created the table)
--   nor v17 (which added tagline) added a `timezone` column.
--   This caused every UPDATE to fail with:
--     "column 'timezone' of relation 'institution_settings' does not exist"
--   → the API returned "فشل في تحديث بيانات المؤسسة" to the admin.
--
--   The RPC `setup_initialize_system` also did not accept a
--   `p_timezone` parameter, so the RPC path failed first, then the
--   direct UPDATE fallback also failed.
--
-- This migration:
--   1. Adds the `timezone` TEXT column to institution_settings.
--   2. Recreates the `setup_initialize_system` RPC to accept and
--      persist `p_timezone`.
-- =============================================================

-- 1. Add timezone column
ALTER TABLE institution_settings ADD COLUMN IF NOT EXISTS timezone TEXT;

-- 2. Recreate the RPC with p_timezone support
--    (DROP + CREATE to ensure the signature is updated even if the
--     function already exists with a different parameter list.)
DROP FUNCTION IF EXISTS setup_initialize_system(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS setup_initialize_system(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION setup_initialize_system(
  p_name TEXT,
  p_name_en TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'center',
  p_logo_url TEXT DEFAULT NULL,
  p_tagline TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
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
  SELECT id INTO v_existing_id FROM institution_settings LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    UPDATE institution_settings SET
      name = p_name, name_en = p_name_en, type = p_type,
      logo_url = p_logo_url, tagline = p_tagline, country = p_country, city = p_city,
      address = p_address, phone = p_phone, email = p_email,
      website = p_website, timezone = p_timezone, academic_year = p_academic_year, description = p_description
    WHERE id = v_existing_id;
    RETURN json_build_object('action', 'updated', 'id', v_existing_id);
  END IF;
  INSERT INTO institution_settings (name, name_en, type, logo_url, tagline, country, city, address, phone, email, website, timezone, academic_year, description)
  VALUES (p_name, p_name_en, p_type, p_logo_url, p_tagline, p_country, p_city, p_address, p_phone, p_email, p_website, p_timezone, p_academic_year, p_description)
  RETURNING id INTO v_id;
  RETURN json_build_object('action', 'created', 'id', v_id);
END;
$$;

COMMENT ON FUNCTION setup_initialize_system IS
  'v132b: Adds p_timezone parameter. Inserts or updates the single institution_settings row.';
