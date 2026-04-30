import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST /api/migrate/initiated-by
 * Adds an `initiated_by` column to the `teacher_student_links` table.
 * Uses the Supabase service role key via the REST API (same pattern as /api/migrate).
 */
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  try {
    // Check if the initiated_by column already exists by trying to select it
    const checkUrl = `${supabaseUrl}/rest/v1/teacher_student_links?select=id,initiated_by&limit=1`;
    const checkResp = await fetch(checkUrl, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (checkResp.ok) {
      return NextResponse.json({
        status: 'migrated',
        message: 'initiated_by column already exists',
      });
    }

    const errorData = await checkResp.json();
    if (errorData.message?.includes('does not exist')) {
      // Column doesn't exist — return SQL for manual execution in Supabase Dashboard
      const sql = `
ALTER TABLE public.teacher_student_links
ADD COLUMN IF NOT EXISTS initiated_by TEXT NOT NULL DEFAULT 'student'
CHECK (initiated_by IN ('student', 'teacher'));

-- Update existing rows: all existing links were initiated by students
UPDATE public.teacher_student_links SET initiated_by = 'student' WHERE initiated_by IS NULL;
      `.trim();

      // Try to execute the migration using the Supabase REST API with service role key
      try {
        const migrateUrl = `${supabaseUrl}/rest/v1/rpc/v9_migrate_initiated_by`;
        const migrateResp = await fetch(migrateUrl, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (migrateResp.ok) {
          return NextResponse.json({
            status: 'migrated',
            message: 'initiated_by column created successfully via RPC',
          });
        }
      } catch {
        // RPC function doesn't exist, fall through to manual SQL
      }

      return NextResponse.json({
        status: 'pending',
        message: 'Migration required. Please run the SQL in Supabase Dashboard SQL Editor.',
        sql,
      });
    }

    return NextResponse.json({ status: 'error', message: errorData.message }, { status: 500 });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * GET /api/migrate/initiated-by
 * Delegates to POST to check/run the migration.
 */
export async function GET() {
  return POST();
}
