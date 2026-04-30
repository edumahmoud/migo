import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/migrate/tagline-column
 * Adds the `tagline` TEXT column to `institution_settings` table.
 * Since we can't run DDL through the Supabase REST API directly,
 * this endpoint checks if the column exists and returns SQL for manual execution if not.
 */
export async function POST() {
  try {
    // Check if tagline column exists by trying to select it
    const { data, error } = await supabaseServer
      .from('institution_settings')
      .select('id, tagline')
      .limit(1);

    if (!error) {
      return NextResponse.json({
        status: 'migrated',
        message: 'tagline column already exists on institution_settings',
        data,
      });
    }

    // Column doesn't exist - check if it's specifically a missing column error
    const isMissingColumn = error.message?.includes('tagline') ||
      error.message?.includes('Could not find') ||
      error.code === '42703';

    if (isMissingColumn) {
      return NextResponse.json({
        status: 'pending',
        message: 'Run this SQL in Supabase Dashboard SQL Editor to add the tagline column:',
        sql: `-- Add tagline column to institution_settings
ALTER TABLE institution_settings ADD COLUMN IF NOT EXISTS tagline TEXT;

-- Update the setup_initialize_system function to include tagline
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
      website = p_website, academic_year = p_academic_year, description = p_description
    WHERE id = v_existing_id;
    RETURN json_build_object('action', 'updated', 'id', v_existing_id);
  END IF;
  INSERT INTO institution_settings (name, name_en, type, logo_url, tagline, country, city, address, phone, email, website, academic_year, description)
  VALUES (p_name, p_name_en, p_type, p_logo_url, p_tagline, p_country, p_city, p_address, p_phone, p_email, p_website, p_academic_year, p_description)
  RETURNING id INTO v_id;
  RETURN json_build_object('action', 'created', 'id', v_id);
END;
$$;`.trim(),
      });
    }

    return NextResponse.json({
      status: 'error',
      message: error.message,
    }, { status: 500 });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
