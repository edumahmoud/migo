import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import type { Lesson } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/lessons/[id]
 *
 * Update a lesson.
 * Only the creator (created_by) or an admin can update a lesson.
 * Updates only the provided fields and refreshes updated_at.
 *
 * Body: { title?, content_json?, content_html? }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
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
      .select('id, created_by, status')
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

    if (existingLesson.created_by !== userId && !isAdmin) {
      return NextResponse.json(
        { error: 'You do not have permission to update this lesson' },
        { status: 403 },
      );
    }

    // Parse and validate the update payload
    const body = await request.json();
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return NextResponse.json(
          { error: 'title must be a non-empty string' },
          { status: 400 },
        );
      }
      updateData.title = body.title.trim();
    }

    if (body.content_json !== undefined) {
      updateData.content_json = body.content_json;
    }

    if (body.content_html !== undefined) {
      if (typeof body.content_html !== 'string') {
        return NextResponse.json(
          { error: 'content_html must be a string' },
          { status: 400 },
        );
      }
      updateData.content_html = body.content_html;
    }

    // If the lesson is already published and content_json is being updated,
    // also update published_json so students see the latest content
    if (body.content_json !== undefined && existingLesson.status === 'published') {
      updateData.published_json = body.content_json;
    }

    // Ensure at least one field is being updated (besides updated_at)
    const fieldsToUpdate = Object.keys(updateData).filter((k) => k !== 'updated_at');
    if (fieldsToUpdate.length === 0) {
      return NextResponse.json(
        { error: 'At least one field must be provided for update' },
        { status: 400 },
      );
    }

    // Perform the update
    const { data: updatedLesson, error: updateError } = await supabaseServer
      .from('lessons')
      .update(updateData)
      .eq('id', lessonId)
      .select()
      .single();

    if (updateError) {
      console.error('[Lessons API] Update error:', updateError.message);
      return NextResponse.json(
        { error: 'Failed to update lesson' },
        { status: 500 },
      );
    }

    return NextResponse.json({ lesson: updatedLesson as Lesson });
  } catch (error) {
    console.error('[Lessons API] PUT unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/lessons/[id]
 *
 * Delete a lesson.
 * Only the creator (created_by) or an admin can delete a lesson.
 * Also deletes associated images from Supabase Storage (lesson-images bucket).
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    // Fetch the lesson with subject_id for storage cleanup
    const { data: existingLesson, error: fetchError } = await supabaseServer
      .from('lessons')
      .select('id, created_by, subject_id')
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

    if (existingLesson.created_by !== userId && !isAdmin) {
      return NextResponse.json(
        { error: 'You do not have permission to delete this lesson' },
        { status: 403 },
      );
    }

    // Delete associated images from Supabase Storage
    const subjectId = existingLesson.subject_id as string;
    try {
      const folderPath = `lessons/${subjectId}`;
      const { data: folderContents } = await supabaseServer.storage
        .from('lesson-images')
        .list(folderPath, { limit: 1000 });

      if (folderContents && folderContents.length > 0) {
        // Build full paths for removal
        const filesToRemove = folderContents.map(
          (file) => `${folderPath}/${file.name}`,
        );

        if (filesToRemove.length > 0) {
          const { error: storageError } = await supabaseServer.storage
            .from('lesson-images')
            .remove(filesToRemove);

          if (storageError) {
            console.error('[Lessons API] Storage cleanup error:', storageError.message);
            // Continue with lesson deletion even if storage cleanup fails
          }
        }
      }
    } catch (storageCleanupErr) {
      console.error('[Lessons API] Storage cleanup exception:', storageCleanupErr);
      // Continue with lesson deletion even if storage cleanup fails
    }

    // Delete the lesson from database
    const { error: deleteError } = await supabaseServer
      .from('lessons')
      .delete()
      .eq('id', lessonId);

    if (deleteError) {
      console.error('[Lessons API] Delete error:', deleteError.message);
      return NextResponse.json(
        { error: 'Failed to delete lesson' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Lessons API] DELETE unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
