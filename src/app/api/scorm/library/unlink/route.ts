import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * POST /api/scorm/library/unlink
 *
 * Unlink a SCORM package from a subject (remove junction row).
 * Body: { package_id, subject_id }
 *
 * - Teachers: can unlink from subjects they own (or co-teach)
 * - Admins/superadmins: can unlink any
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const userId = authResult.user.id;
    const body = await request.json();
    const { package_id, subject_id } = body;

    if (!package_id || !subject_id) {
      return NextResponse.json(
        { success: false, error: 'package_id and subject_id are required' },
        { status: 400 },
      );
    }

    const role = await getUserRole(userId);
    const isAdmin = role === 'admin' || role === 'superadmin';

    if (!isAdmin) {
      // Verify the user has access to the subject
      const { data: subject } = await supabaseServer
        .from('subjects')
        .select('teacher_id')
        .eq('id', subject_id)
        .maybeSingle();

      if (!subject) {
        return NextResponse.json(
          { success: false, error: 'Subject not found' },
          { status: 404 },
        );
      }
      if (subject.teacher_id !== userId) {
        const { data: coTeacher } = await supabaseServer
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', subject_id)
          .eq('teacher_id', userId)
          .maybeSingle();
        if (!coTeacher) {
          return NextResponse.json(
            { success: false, error: 'You do not have access to this subject' },
            { status: 403 },
          );
        }
      }
    }

    const { error: deleteError } = await supabaseServer
      .from('scorm_package_subjects')
      .delete()
      .eq('package_id', package_id)
      .eq('subject_id', subject_id);

    if (deleteError) {
      console.error('[SCORM Library Unlink] Delete error:', deleteError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to unlink package' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[SCORM Library Unlink] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to unlink package' },
      { status: 500 },
    );
  }
}
