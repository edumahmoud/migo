import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/migrate/assignments-due-date
 * Migrates the assignments.due_date column from DATE to TIMESTAMPTZ.
 * This is needed because DATE strips time info, causing tasks to show
 * as expired (انتهى) at 2AM local time (UTC midnight + timezone offset).
 */
export async function POST() {
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
    // Check current column type by testing if time is preserved
    const testTime = '2025-12-31T23:59:00.000Z';
    const testTitle = `__migration_test_${Date.now()}`;

    const { data: subjects } = await supabaseServer
      .from('subjects')
      .select('id, teacher_id')
      .limit(1);

    if (!subjects || subjects.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No subjects found for migration test',
        sql: getMigrationSQL(),
      }, { status: 500 });
    }

    const testSubject = subjects[0];

    const { data: testInsert, error: insertError } = await supabaseServer
      .from('assignments')
      .insert({
        subject_id: testSubject.id,
        teacher_id: testSubject.teacher_id,
        title: testTitle,
        due_date: testTime,
        max_score: 1,
        allow_file_submission: false,
      })
      .select('id, due_date')
      .single();

    if (insertError) {
      return NextResponse.json({
        success: false,
        error: `Failed to insert test record: ${insertError.message}`,
        sql: getMigrationSQL(),
      }, { status: 500 });
    }

    const dueDateStr = testInsert?.due_date as string;
    const timePreserved = dueDateStr && dueDateStr.includes('T') && dueDateStr.includes('23:59');

    if (testInsert?.id) {
      await supabaseServer.from('assignments').delete().eq('id', testInsert.id);
    }

    if (timePreserved) {
      return NextResponse.json({
        success: true,
        migrated: false,
        message: 'due_date column already supports timestamps. No migration needed.',
      });
    }

    // Column is DATE type - need migration
    return NextResponse.json({
      success: false,
      needsManualMigration: true,
      message: 'يجب تغيير نوع عمود الموعد النهائي من DATE إلى TIMESTAMPTZ. يرجى تنفيذ SQL التالي في محرر SQL في لوحة تحكم Supabase.',
      sql: getMigrationSQL(),
    }, { status: 202 });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      sql: getMigrationSQL(),
    }, { status: 500 });
  }
}

/**
 * GET /api/migrate/assignments-due-date
 * Checks if migration is needed without making changes.
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ needsMigration: true, sql: getMigrationSQL() });
  }

  try {
    const { data: assignments } = await supabaseServer
      .from('assignments')
      .select('due_date')
      .not('due_date', 'is', null)
      .limit(1);

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({
        needsMigration: true,
        message: 'لا توجد مهام للاختبار. يرجى تنفيذ SQL التالي في محرر SQL في لوحة تحكم Supabase.',
        sql: getMigrationSQL(),
      });
    }

    const dueDate = assignments[0].due_date as string;
    const needsMigration = !dueDate || !dueDate.includes('T');

    return NextResponse.json({
      needsMigration,
      currentType: needsMigration ? 'DATE' : 'TIMESTAMPTZ',
      message: needsMigration
        ? 'يجب تغيير نوع عمود الموعد النهائي. يرجى تنفيذ SQL التالي في محرر SQL في لوحة تحكم Supabase.'
        : 'عمود الموعد النهائي يدعم الوقت بالفعل.',
      sql: needsMigration ? getMigrationSQL() : undefined,
    });
  } catch (err) {
    return NextResponse.json({
      needsMigration: true,
      error: err instanceof Error ? err.message : 'Unknown error',
      sql: getMigrationSQL(),
    });
  }
}

function getMigrationSQL(): string {
  return `
-- =====================================================
-- MIGRATION: Change assignments.due_date from DATE to TIMESTAMPTZ
-- This fixes tasks showing as expired (انتهى) at 2AM
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

ALTER TABLE public.assignments
ALTER COLUMN due_date TYPE TIMESTAMPTZ
USING due_date::TIMESTAMPTZ;
  `.trim();
}
