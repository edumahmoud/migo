import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/migrate/subject-category
 * Adds the `category` TEXT column to `subjects` table.
 * Checks if column exists and returns SQL for manual execution if not.
 */
export async function POST(request: NextRequest) {
  // ─── Security: Only superadmin can run migrations ───
  const adminResult = await requireSuperAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

  try {
    // Check if category column exists by trying to select it
    const { data, error } = await supabaseServer
      .from('subjects')
      .select('id, category')
      .limit(1);

    if (!error) {
      return NextResponse.json({
        status: 'migrated',
        message: 'category column already exists on subjects',
        data,
      });
    }

    // Column doesn't exist - check if it's specifically a missing column error
    const isMissingColumn = error.message?.includes('category') ||
      error.message?.includes('Could not find') ||
      error.code === '42703';

    if (isMissingColumn) {
      return NextResponse.json({
        status: 'pending',
        message: 'Run this SQL in Supabase Dashboard SQL Editor to add the category column:',
        sql: `-- Add category column to subjects
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;`.trim(),
      });
    }

    console.error('[Migration] Subject category check error:', error);
    return NextResponse.json({
      status: 'error',
      message: 'حدث خطأ أثناء تنفيذ الترحيل',
    }, { status: 500 });
  } catch (err) {
    console.error('[Migration] Error:', err);
    return NextResponse.json({
      status: 'error',
      message: 'حدث خطأ أثناء تنفيذ الترحيل',
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
