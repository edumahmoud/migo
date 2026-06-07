import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/migrate/assignments-show-grade
 * Checks if the show_grade column exists in the assignments table.
 * POST /api/migrate/assignments-show-grade
 * Adds the show_grade column if it doesn't exist.
 */
export async function GET(request: NextRequest) {
  // ─── Security: Only superadmin can run migrations ───
  const adminResult = await requireSuperAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

  try {
    // Try to select show_grade to see if the column exists
    const { data, error } = await supabaseServer
      .from('assignments')
      .select('show_grade')
      .limit(1);

    if (error) {
      // Column doesn't exist
      return NextResponse.json({
        needsMigration: true,
        message: 'عمود show_grade غير موجود. يرجى تنفيذ SQL التالي في محرر SQL في لوحة تحكم Supabase.',
        sql: getMigrationSQL(),
      });
    }

    return NextResponse.json({
      needsMigration: false,
      message: 'عمود show_grade موجود بالفعل.',
    });
  } catch (err) {
    console.error('[Migration] Error:', err);
    return NextResponse.json({
      needsMigration: true,
      error: 'حدث خطأ أثناء تنفيذ الترحيل',
      sql: getMigrationSQL(),
    });
  }
}

export async function POST(request: NextRequest) {
  // ─── Security: Only superadmin can run migrations ───
  const adminResult = await requireSuperAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({
      success: false,
      error: 'Missing Supabase credentials',
      sql: getMigrationSQL(),
    }, { status: 500 });
  }

  try {
    // First check if column already exists
    const { data: checkData, error: checkError } = await supabaseServer
      .from('assignments')
      .select('show_grade')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        success: true,
        migrated: false,
        message: 'عمود show_grade موجود بالفعل. لا حاجة للترحيل.',
      });
    }

    // Column doesn't exist - need manual migration
    return NextResponse.json({
      success: false,
      needsManualMigration: true,
      message: 'يرجى تنفيذ SQL التالي في محرر SQL في لوحة تحكم Supabase لإضافة عمود إظهار التقييم.',
      sql: getMigrationSQL(),
    }, { status: 202 });
  } catch (err) {
    console.error('[Migration] Error:', err);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ أثناء تنفيذ الترحيل',
      sql: getMigrationSQL(),
    }, { status: 500 });
  }
}

function getMigrationSQL(): string {
  return `
-- =====================================================
-- MIGRATION: Add show_grade column to assignments table
-- This allows teachers to control whether students
-- can see their grades and feedback
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

ALTER TABLE public.assignments
ADD COLUMN IF NOT EXISTS show_grade BOOLEAN NOT NULL DEFAULT true;
  `.trim();
}
