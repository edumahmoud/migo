import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/migrate/enhanced-ban
 * Checks if the enhanced ban system columns exist.
 */
export async function GET() {
  try {
    const { error: checkError } = await supabaseServer
      .from('banned_users')
      .select('id, user_id, ban_until, banned_by, is_active')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        status: 'migrated',
        message: 'Enhanced ban system columns already exist',
      });
    }

    return NextResponse.json({
      status: 'pending',
      message: 'Enhanced ban columns missing. Please run this SQL in your Supabase Dashboard SQL Editor:',
      sql: getMigrationSQL(),
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * POST /api/migrate/enhanced-ban
 * Apply the enhanced ban system migration by executing SQL directly.
 * Uses the Supabase PostgreSQL wire protocol via the REST API.
 */
export async function POST() {
  try {
    // Check if columns already exist
    const { error: checkError } = await supabaseServer
      .from('banned_users')
      .select('id, user_id, ban_until, banned_by, is_active')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        success: true,
        status: 'already_migrated',
        message: 'Enhanced ban system columns already exist',
      });
    }

    // Try applying using the Supabase Management API SQL endpoint
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({
        success: false,
        error: 'Missing Supabase credentials',
        sql: getMigrationSQL(),
      }, { status: 500 });
    }

    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

    // Try the Supabase Management API SQL endpoint
    try {
      const queryResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: getMigrationSQL() }),
      });

      if (queryResponse.ok) {
        // Verify
        const { error: verifyError } = await supabaseServer
          .from('banned_users')
          .select('id, user_id, ban_until, banned_by, is_active')
          .limit(1);

        if (!verifyError) {
          return NextResponse.json({
            success: true,
            status: 'migrated',
            message: 'Enhanced ban system columns added successfully',
          });
        }
      }
    } catch {
      // Management API not available
    }

    // Cannot auto-apply - return SQL for manual execution
    return NextResponse.json({
      success: false,
      status: 'manual_required',
      error: 'لا يمكن تطبيق الترقية تلقائياً. يرجى تشغيل SQL يدوياً في محرر SQL بلوحة تحكم Supabase',
      sql: getMigrationSQL(),
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      sql: getMigrationSQL(),
    }, { status: 500 });
  }
}

function getMigrationSQL(): string {
  return `
-- Enhanced ban system migration (v15)
-- Run this SQL in your Supabase Dashboard SQL Editor

-- Add new columns
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS banned_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.banned_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

-- Add indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_banned_users_user_id ON public.banned_users(user_id);
CREATE INDEX IF NOT EXISTS idx_banned_users_is_active ON public.banned_users(is_active);
CREATE INDEX IF NOT EXISTS idx_banned_users_ban_until ON public.banned_users(ban_until);

-- Update existing records to be active
UPDATE public.banned_users SET is_active = true WHERE is_active IS NULL;
  `.trim();
}
