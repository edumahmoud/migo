import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// ─── GET: Check if the system is initialized ───
export async function GET() {
  try {
    // Count users to determine if this is truly a fresh install
    const { count: userCount } = await supabaseServer
      .from('users')
      .select('*', { count: 'exact', head: true });

    // If there are already users in the database, the system is considered initialized
    // even if institution_settings hasn't been configured yet.
    // The setup wizard is ONLY for the very first time (no users at all).
    if (userCount && userCount > 0) {
      // Try to fetch institution settings for the response
      const { data: instData } = await supabaseServer
        .from('institution_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      return NextResponse.json({
        initialized: true,
        institution: instData || null,
        tableExists: true,
        hasUsers: true,
      });
    }

    // No users — check if institution_settings table exists
    const { data, error } = await supabaseServer
      .from('institution_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      // PGRST205 = PostgREST schema cache error (table not found)
      // 42P01 = undefined table
      const isTableMissing = error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message?.includes('does not exist') ||
        error.message?.includes('relation') ||
        error.message?.includes('Could not find the table');

      return NextResponse.json({ initialized: false, tableExists: !isTableMissing, hasUsers: false });
    }

    if (data) {
      // No users but institution data exists — still needs setup (create admin account)
      return NextResponse.json({ initialized: false, institution: data, tableExists: true, hasUsers: false });
    }

    return NextResponse.json({ initialized: false, tableExists: true, hasUsers: false });
  } catch (err) {
    console.error('[setup] Error:', err);
    return NextResponse.json({ initialized: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Save institution data ───
export async function POST(request: NextRequest) {
  try {
    // ─── Role check: Only superadmin can modify institution settings ───
    const userId = request.headers.get('x-user-id');
    if (userId) {
      const { data: userProfile } = await supabaseServer
        .from('users')
        .select('role')
        .eq('id', userId)
        .single();

      if (!userProfile || userProfile.role !== 'superadmin') {
        return NextResponse.json({ error: 'غير مصرح: مدير النظام فقط يمكنه تعديل بيانات المؤسسة' }, { status: 403 });
      }
    } else {
      // Try Bearer token auth
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const { createClient } = await import('@supabase/supabase-js');
        const { data: { user } } = await supabaseServer.auth.getUser(token);
        if (user) {
          const { data: userProfile } = await supabaseServer
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single();

          if (!userProfile || userProfile.role !== 'superadmin') {
            return NextResponse.json({ error: 'غير مصرح: مدير النظام فقط يمكنه تعديل بيانات المؤسسة' }, { status: 403 });
          }
        }
      } else {
        // No auth info provided — for initial setup (no users yet), allow the request
        // But if there are already users, require auth
        const { count } = await supabaseServer
          .from('users')
          .select('*', { count: 'exact', head: true });

        if (count && count > 0) {
          return NextResponse.json({ error: 'غير مصرح: يجب تسجيل الدخول لتعديل بيانات المؤسسة' }, { status: 401 });
        }
      }
    }

    const body = await request.json();
    const {
      action,
      name,
      nameEn,
      type,
      logo_url,
      tagline,
      country,
      city,
      address,
      phone,
      email,
      website,
      academic_year,
      description,
    } = body;

    // ─── Action: Save institution data ───
    if (action === 'save_institution') {
      if (!name || !type) {
        return NextResponse.json({ error: 'اسم المؤسسة ونوعها مطلوبان' }, { status: 400 });
      }

      // Try using RPC first (if the migration has been run)
      const { data: rpcData, error: rpcError } = await supabaseServer
        .rpc('setup_initialize_system', {
          p_name: name,
          p_name_en: nameEn || null,
          p_type: type,
          p_logo_url: logo_url || null,
          p_tagline: tagline || null,
          p_country: country || null,
          p_city: city || null,
          p_address: address || null,
          p_phone: phone || null,
          p_email: email || null,
          p_website: website || null,
          p_academic_year: academic_year || null,
          p_description: description || null,
        });

      if (!rpcError && rpcData) {
        // RPC succeeded, but tagline might not be supported by the old function
        // Try to update tagline separately if provided
        if (tagline !== undefined) {
          const { data: existing } = await supabaseServer
            .from('institution_settings')
            .select('id')
            .maybeSingle();
          if (existing) {
            await supabaseServer
              .from('institution_settings')
              .update({ tagline: tagline || null })
              .eq('id', existing.id);
          }
        }
        return NextResponse.json({ success: true, action: rpcData.action || 'created', via: 'rpc' });
      }

      // RPC not available - try direct insert (table might exist without RPC)
      const { data: existing } = await supabaseServer
        .from('institution_settings')
        .select('id')
        .maybeSingle();

      if (existing) {
        // Build update object, only include tagline if the column exists
        const updateObj: Record<string, unknown> = {
          name,
          name_en: nameEn || null,
          type,
          logo_url: logo_url || null,
          country: country || null,
          city: city || null,
          address: address || null,
          phone: phone || null,
          email: email || null,
          website: website || null,
          academic_year: academic_year || null,
          description: description || null,
        };

        // Try to include tagline in the update; if the column doesn't exist yet,
        // the error will be caught and we retry without it
        if (tagline !== undefined) {
          updateObj.tagline = tagline || null;
        }

        let { error } = await supabaseServer
          .from('institution_settings')
          .update(updateObj)
          .eq('id', existing.id);

        // If tagline column doesn't exist, retry without it
        if (error && tagline !== undefined && error.message?.includes('tagline')) {
          delete updateObj.tagline;
          const retryResult = await supabaseServer
            .from('institution_settings')
            .update(updateObj)
            .eq('id', existing.id);
          error = retryResult.error;
        }

        if (error) {
          console.error('[setup] Error updating institution:', error);
          return NextResponse.json({ error: 'فشل في تحديث بيانات المؤسسة' }, { status: 500 });
        }

        return NextResponse.json({ success: true, action: 'updated', via: 'direct' });
      }

      // Insert new
      const insertObj: Record<string, unknown> = {
        name,
        name_en: nameEn || null,
        type,
        logo_url: logo_url || null,
        country: country || null,
        city: city || null,
        address: address || null,
        phone: phone || null,
        email: email || null,
        website: website || null,
        academic_year: academic_year || null,
        description: description || null,
      };

      // Try to include tagline; if column doesn't exist, retry without it
      if (tagline !== undefined) {
        insertObj.tagline = tagline || null;
      }

      let { error: insertError } = await supabaseServer
        .from('institution_settings')
        .insert(insertObj);

      // If tagline column doesn't exist, retry without it
      if (insertError && tagline !== undefined && insertError.message?.includes('tagline')) {
        delete insertObj.tagline;
        const retryResult = await supabaseServer
          .from('institution_settings')
          .insert(insertObj);
        insertError = retryResult.error;
      }

      if (insertError) {
        console.error('[setup] Error saving institution:', insertError);
        // If table doesn't exist, return the SQL for manual execution
        const isTableMissing = insertError.code === '42P01' ||
          insertError.code === 'PGRST205' ||
          insertError.message?.includes('Could not find the table');

        if (isTableMissing) {
          return NextResponse.json({
            error: 'جدول institution_settings غير موجود. يرجى تنفيذ SQL التالي في محرر SQL في لوحة تحكم Supabase:',
            needsMigration: true,
            sql: getMigrationSQL(),
          }, { status: 500 });
        }

        return NextResponse.json({ error: 'فشل في حفظ بيانات المؤسسة' }, { status: 500 });
      }

      return NextResponse.json({ success: true, action: 'created', via: 'direct' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[setup] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getMigrationSQL(): string {
  return `
-- Run this SQL in your Supabase SQL Editor
-- =========================================

CREATE TABLE IF NOT EXISTS institution_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_en TEXT,
  type TEXT NOT NULL CHECK (type IN ('center', 'school', 'university')),
  logo_url TEXT,
  tagline TEXT,
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

ALTER TABLE institution_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Anyone can read institution_settings" ON institution_settings
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service can insert institution_settings" ON institution_settings
    FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service can update institution_settings" ON institution_settings
    FOR UPDATE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
$$;
`;
}
