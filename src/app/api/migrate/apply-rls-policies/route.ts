import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * Verify admin data access and provide RLS fix SQL.
 * POST /api/migrate/apply-rls-policies
 * Body: { "confirm": true }
 */
export async function POST(request: NextRequest) {
  // ─── Security: Only superadmin can run migrations ───
  const adminResult = await requireSuperAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

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
        results.push(`${table}: ERROR`);
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
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تنفيذ الترحيل' },
      { status: 500 }
    );
  }
}
