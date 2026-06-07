import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/migrate/fix-teams-updated-at
 *
 * One-time migration: Add missing updated_at column to subject_teams table.
 * The generic update_updated_at() trigger was applied to subject_teams
 * but the table was created without an updated_at column, causing all
 * UPDATE operations to fail with: "record 'new' has no field 'updated_at'"
 *
 * Uses the Supabase SQL API to execute DDL statements.
 * Requires superadmin access.
 */
export async function POST(request: NextRequest) {
  // ─── Security: Only superadmin can run migrations ───
  const adminResult = await requireSuperAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
    }

    // Execute DDL via Supabase SQL API
    // The Supabase project has a /pg/query endpoint that accepts raw SQL
    // But this requires the Supabase personal access token, not the service key.
    //
    // Alternative: Use the REST API's RPC mechanism.
    // We'll create a temporary stored procedure using a workaround:
    // We can use the Supabase /rest/v1/rpc endpoint if we can create
    // the function first. But we can't create functions via REST.
    //
    // The most reliable approach: Execute the SQL via the Supabase
    // Dashboard SQL Editor manually. But for automation, we'll try
    // to use the pg_net extension or a direct PostgreSQL connection.

    // Let's try the simplest approach: use the Supabase Management API
    // POST /v1/projects/{ref}/sql endpoint

    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

    const sqlPayload = {
      query: `
        -- Add updated_at column if not exists
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'subject_teams' AND column_name = 'updated_at'
          ) THEN
            ALTER TABLE public.subject_teams ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;
          END IF;
        END$$;

        -- Create or replace the auto-update trigger
        DROP TRIGGER IF EXISTS trg_subject_teams_updated_at ON public.subject_teams;
        CREATE TRIGGER trg_subject_teams_updated_at
          BEFORE UPDATE ON public.subject_teams
          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
      `,
    };

    // Try Supabase Management API (requires access token, not service key)
    // This might not work, but let's try
    const sqlResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(sqlPayload),
    });

    if (sqlResponse.ok) {
      console.log('[Migration] SQL executed successfully via Management API');
      return NextResponse.json({
        success: true,
        message: 'Migration applied successfully: updated_at column added to subject_teams',
      });
    }

    // Management API failed - likely because service key is not a personal access token
    // Fall back to trying the Supabase project SQL endpoint
    const directResponse = await fetch(`${supabaseUrl}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(sqlPayload),
    });

    if (directResponse.ok) {
      return NextResponse.json({
        success: true,
        message: 'Migration applied successfully',
      });
    }

    // Both methods failed - return SQL for manual execution
    const directError = await directResponse.text();
    console.log('[Migration] Direct SQL endpoint failed:', directError);

    return NextResponse.json({
      success: false,
      needsManualExecution: true,
      error: 'لا يمكن تنفيذ الترحيل تلقائياً. يرجى نسخ SQL أدناه وتنفيذه في Supabase SQL Editor',
      sql: `-- Fix: Add updated_at column to subject_teams table
-- Run this in: Supabase Dashboard > SQL Editor

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subject_teams' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.subject_teams ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_subject_teams_updated_at ON public.subject_teams;
CREATE TRIGGER trg_subject_teams_updated_at
  BEFORE UPDATE ON public.subject_teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();`,
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تنفيذ الترحيل' },
      { status: 500 }
    );
  }
}
