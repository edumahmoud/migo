import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireRole } from '@/lib/api-security';

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
// SECURITY: This endpoint can only be used before the system is initialized (no users).
// Once users exist, it requires admin/superadmin role.
export async function POST(request: NextRequest) {
  try {
    // Check if system is already initialized
    const { count: userCount } = await supabaseServer
      .from('users')
      .select('*', { count: 'exact', head: true });

    const isInitialized = userCount && userCount > 0;

    // If system is already initialized, require admin role
    if (isInitialized) {
      const { user: authUser, error: authError } = await requireRole(request, ['admin', 'superadmin']);
      if (authError) return authError;
    }
    // If system is NOT initialized, allow unauthenticated access (first-time setup)

    const body = await request.json();
    const {
      action,
      name,
      nameEn,
      type,
      logo_url,
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
        return NextResponse.json({ success: true, action: rpcData.action || 'created', via: 'rpc' });
      }

      // RPC not available - try direct insert (table might exist without RPC)
      const { data: existing } = await supabaseServer
        .from('institution_settings')
        .select('id')
        .maybeSingle();

      if (existing) {
        const { error } = await supabaseServer
          .from('institution_settings')
          .update({
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
          })
          .eq('id', existing.id);

        if (error) {
          console.error('[setup] Error updating institution:', error);
          return NextResponse.json({ error: 'فشل في تحديث بيانات المؤسسة' }, { status: 500 });
        }

        return NextResponse.json({ success: true, action: 'updated', via: 'direct' });
      }

      // Insert new
      const { error: insertError } = await supabaseServer
        .from('institution_settings')
        .insert({
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
        });

      if (insertError) {
        console.error('[setup] Error saving institution:', insertError);
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

    // ─── Action: Auto-create institution_settings table ──
    // SECURITY: Allow unauthenticated access if system is not yet initialized.
    // If system is already initialized, require admin role.
    if (action === 'create_table') {
      if (isInitialized) {
        const { user: authUser, error: authError } = await requireRole(request, ['admin', 'superadmin']);
        if (authError) return authError;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

      if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY غير مُعد' }, { status: 500 });
      }

      try {
        // Attempt: Try to insert a test row to check if table exists
        const { error: testError } = await supabaseServer
          .from('institution_settings')
          .select('id')
          .limit(1);

        if (!testError) {
          return NextResponse.json({ success: true, tableExists: true });
        }

        // Table doesn't exist - try to create it via SQL execution
        const migrationSQL = getMigrationSQL();

        // Execute via Supabase SQL API
        const sqlResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/setup_run_migration`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ sql: migrationSQL }),
        });

        if (sqlResponse.ok) {
          return NextResponse.json({ success: true, tableExists: true });
        }

        // RPC not available - return the SQL for manual execution
        return NextResponse.json({
          success: false,
          tableExists: false,
          error: 'لا يمكن إنشاء الجدول تلقائياً. يرجى تنفيذ SQL يدوياً.',
          sql: migrationSQL,
          needsManualSetup: true,
        });
      } catch (err) {
        console.error('[setup] create_table error:', err);
        return NextResponse.json({
          success: false,
          tableExists: false,
          error: 'حدث خطأ أثناء إنشاء الجدول',
          sql: getMigrationSQL(),
          needsManualSetup: true,
        });
      }
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

-- Atomic first-user promotion function (prevents race conditions)
CREATE OR REPLACE FUNCTION promote_first_user(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM users;
  IF v_count = 1 THEN
    UPDATE users SET role = 'superadmin', updated_at = NOW() WHERE id = p_user_id;
    RETURN json_build_object('promoted', true, 'role', 'superadmin');
  END IF;
  RETURN json_build_object('promoted', false);
END;
$$;
`;
}
