import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * Verify admin data access and provide RLS fix SQL.
 * POST /api/migrate/apply-rls-policies
 * Body: { "confirm": true }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.confirm) {
      return NextResponse.json(
        { success: false, error: 'Send { "confirm": true } to execute' },
        { status: 400 }
      );
    }

    const results: string[] = [];
    const tables = [
      'users', 'subjects', 'scores', 'quizzes', 'teacher_student_links',
      'subject_students', 'subject_teachers', 'lectures', 'assignments',
      'submissions', 'attendance_sessions', 'attendance_records',
      'announcements', 'banned_users', 'institution_settings',
      'summaries', 'lecture_notes', 'user_files', 'subject_files',
      'file_shares', 'file_requests', 'notifications', 'user_sessions',
      'conversations', 'conversation_participants', 'messages'
    ];

    for (const table of tables) {
      const { count, error } = await supabaseServer
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        results.push(`${table}: ERROR - ${error.message}`);
      } else {
        results.push(`${table}: OK (${count})`);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Service role verification complete.',
      tableStatus: results,
      note: 'Run supabase/fix_admin_rls_policies.sql in Supabase Dashboard SQL Editor for client-side query access.',
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
