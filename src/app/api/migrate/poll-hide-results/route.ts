/**
 * POST /api/migrate/poll-hide-results
 * Adds hide_results column to polls table
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
    }

    // Verify admin via auth header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use Supabase REST API to check if column exists
    const checkResponse = await fetch(`${supabaseUrl}/rest/v1/polls?select=hide_results&limit=1`, {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    if (checkResponse.ok) {
      return NextResponse.json({ status: 'already_migrated', message: 'hide_results column already exists' });
    }

    // Column doesn't exist — return SQL for manual execution
    const sql = 'ALTER TABLE public.polls ADD COLUMN IF NOT EXISTS hide_results BOOLEAN NOT NULL DEFAULT false;';

    return NextResponse.json({
      status: 'manual_migration_required',
      sql,
      message: 'Please run this SQL in Supabase Dashboard → SQL Editor to add the hide_results column',
    });
  } catch (err) {
    console.error('[migrate/poll-hide-results] Error:', err);
    return NextResponse.json({ error: 'Migration check failed', details: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    migration: 'poll-hide-results',
    description: 'Adds hide_results column to polls table',
    sql: 'ALTER TABLE public.polls ADD COLUMN IF NOT EXISTS hide_results BOOLEAN NOT NULL DEFAULT false;',
  });
}
