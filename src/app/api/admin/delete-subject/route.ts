import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { subjectId } = body;

    if (!subjectId) {
      return NextResponse.json(
        { success: false, error: 'معرف المقرر مطلوب' },
        { status: 400 }
      );
    }

    // Fetch subject name before deleting (for logging)
    const { data: subjectRecord } = await supabaseServer
      .from('subjects')
      .select('id, name')
      .eq('id', subjectId)
      .maybeSingle();

    if (!subjectRecord) {
      return NextResponse.json(
        { success: false, error: 'المقرر غير موجود' },
        { status: 404 }
      );
    }

    // v107: Manual cascade — NULL out FK references that might block
    // deletion. v106 should have changed these to SET NULL, but this
    // is defense-in-depth in case v106 wasn't applied or there are
    // other FKs we missed.
    const cleanupTables = [
      { table: 'quizzes', column: 'subject_id' },
    ];

    for (const { table, column } of cleanupTables) {
      try {
        await supabaseServer
          .from(table)
          .update({ [column]: null })
          .eq(column, subjectId);
      } catch {
        // Table/column might not exist — skip
      }
    }

    // Delete the subject — cascades to subject_students, lectures, notes,
    // assignments, subject_files, subject_videos, etc.
    const { error } = await supabaseServer
      .from('subjects')
      .delete()
      .eq('id', subjectId);

    if (error && !error.message.includes('no rows') && error.code !== 'PGRST116') {
      console.error('Error deleting subject:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حذف المقرر' },
        { status: 500 }
      );
    }

    // Log the deletion (best-effort)
    try {
      await supabaseServer
        .from('platform_announcements')
        .insert({
          title: `تم حذف المقرر: ${subjectRecord.name}`,
          content: `قام ${authResult.user.id} بحذف المقرر ${subjectId} (${subjectRecord.name})`,
          type: 'system',
          created_by: authResult.user.id,
          is_pinned: false,
        });
    } catch {
      // Non-fatal — just logging
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete subject error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
