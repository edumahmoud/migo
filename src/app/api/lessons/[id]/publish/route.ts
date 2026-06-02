import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/lessons/[id]/publish
 *
 * Toggle a lesson between 'draft' and 'published' status.
 * Only the teacher/admin who owns the lesson (created_by) can publish/unpublish.
 *
 * When publishing:
 *   - Set status = 'published'
 *   - Set published_at = now
 *   - Snapshot content_json to published_json
 *
 * When unpublishing:
 *   - Set status = 'draft'
 *   - Clear published_at
 *
 * Body (optional): { unpublish: boolean }
 *   - If unpublish is true → set status to 'draft'
 *   - If unpublish is false or absent → set status to 'published'
 *
 * Returns: { status: 'draft' | 'published' }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: lessonId } = await params;

    if (!lessonId) {
      return NextResponse.json(
        { error: 'Lesson ID is required' },
        { status: 400 },
      );
    }

    // Fetch the existing lesson
    const { data: existingLesson, error: fetchError } = await supabaseServer
      .from('lessons')
      .select('id, created_by, status, content_json')
      .eq('id', lessonId)
      .single();

    if (fetchError || !existingLesson) {
      return NextResponse.json(
        { error: 'Lesson not found' },
        { status: 404 },
      );
    }

    // Check ownership or admin
    const role = await getUserRole(userId);
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isTeacherOrAdmin = role === 'teacher' || isAdmin;

    if (!isTeacherOrAdmin) {
      return NextResponse.json(
        { error: 'Only teachers and admins can publish/unpublish lessons' },
        { status: 403 },
      );
    }

    if (existingLesson.created_by !== userId && !isAdmin) {
      return NextResponse.json(
        { error: 'You do not have permission to publish/unpublish this lesson' },
        { status: 403 },
      );
    }

    // Parse optional body
    let unpublish = false;
    try {
      const body = await request.json();
      if (body?.unpublish === true) {
        unpublish = true;
      }
    } catch {
      // No body or invalid JSON — treat as publish action
    }

    // Determine the target status
    const currentStatus = existingLesson.status as string;

    if (unpublish) {
      // Unpublish: set to draft, clear published_at
      if (currentStatus === 'draft') {
        // Already draft, no change needed
        return NextResponse.json({ status: 'draft' as const });
      }

      const { error: updateError } = await supabaseServer
        .from('lessons')
        .update({
          status: 'draft',
          published_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lessonId);

      if (updateError) {
        console.error('[Lessons API] Unpublish error:', updateError.message);
        return NextResponse.json(
          { error: 'Failed to unpublish lesson' },
          { status: 500 },
        );
      }

      return NextResponse.json({ status: 'draft' as const });
    } else {
      // Publish: set to published, set published_at, snapshot content_json
      if (currentStatus === 'published') {
        // Already published, no change needed
        return NextResponse.json({ status: 'published' as const });
      }

      const updatePayload: Record<string, unknown> = {
        status: 'published',
        published_at: new Date().toISOString(),
        published_json: existingLesson.content_json,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabaseServer
        .from('lessons')
        .update(updatePayload)
        .eq('id', lessonId);

      if (updateError) {
        console.error('[Lessons API] Publish error:', updateError.message);
        return NextResponse.json(
          { error: 'Failed to publish lesson' },
          { status: 500 },
        );
      }

      return NextResponse.json({ status: 'published' as const });
    }
  } catch (error) {
    console.error('[Lessons API] Publish unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
