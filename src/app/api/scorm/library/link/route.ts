import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * POST /api/scorm/library/link
 *
 * Link a platform-level SCORM package to a subject.
 * Body: { package_id, subject_id }
 *
 * - Teachers: can link to subjects they own (or co-teach)
 * - Admins/superadmins: can link any package to any subject
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

    // Verify the package exists and is a platform-level package (subject_id IS NULL)
    const { data: pkg, error: pkgError } = await supabaseServer
      .from('scorm_packages')
      .select('id, subject_id, is_platform_library')
      .eq('id', package_id)
      .maybeSingle();

    if (pkgError || !pkg) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 },
      );
    }

    // Allow linking both platform-level (subject_id NULL) and subject-scoped packages (cross-link)
    // For platform-level packages, anyone with subject access can link.
    // For subject-scoped packages, only the original subject's teacher OR admin can cross-link.

    // Verify subject exists
    const { data: subject } = await supabaseServer
      .from('subjects')
      .select('id, teacher_id')
      .eq('id', subject_id)
      .maybeSingle();

    if (!subject) {
      return NextResponse.json(
        { success: false, error: 'Subject not found' },
        { status: 404 },
      );
    }

    // Access check: teacher must own or co-teach the target subject
    if (!isAdmin) {
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

    // Insert link (UNIQUE constraint prevents duplicates)
    const { error: linkError } = await supabaseServer
      .from('scorm_package_subjects')
      .upsert(
        { package_id, subject_id, linked_by: userId },
        { onConflict: 'package_id,subject_id' },
      );

    if (linkError) {
      console.error('[SCORM Library Link] Insert error:', linkError.message);
      return NextResponse.json(
        { success: false, error: 'Failed to link package' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[SCORM Library Link] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to link package' },
      { status: 500 },
    );
  }
}
