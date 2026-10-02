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
      .select('id, created_by, status, subject_id')
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

    // v63: unit_id (allow null to unassign from unit)
    if (body.unit_id !== undefined) {
      if (body.unit_id === null) {
        updateData.unit_id = null;
        updateData.order_within_unit = 0;
      } else if (typeof body.unit_id === 'string') {
        // Verify the unit belongs to the same subject
        const { data: unitCheck } = await supabaseServer
          .from('lesson_units')
          .select('id, subject_id')
          .eq('id', body.unit_id)
          .maybeSingle();
        if (!unitCheck || unitCheck.subject_id !== existingLesson.subject_id) {
          return NextResponse.json(
            { error: 'unit_id does not belong to this subject' },
            { status: 400 },
          );
        }
        updateData.unit_id = body.unit_id;
      }
    }

    // v63: order_within_unit
    if (body.order_within_unit !== undefined && typeof body.order_within_unit === 'number') {
      updateData.order_within_unit = body.order_within_unit;
    }

    // v63: pass_threshold (allow null to remove gate)
    if (body.pass_threshold !== undefined) {
      if (
        body.pass_threshold !== null &&
        (typeof body.pass_threshold !== 'number' || body.pass_threshold < 0 || body.pass_threshold > 100)
      ) {
        return NextResponse.json(
          { error: 'pass_threshold must be a number between 0 and 100 (or null)' },
          { status: 400 },
        );
      }
      updateData.pass_threshold = body.pass_threshold;
    }

    // v102: video fields
    if (body.video_url !== undefined) {
      updateData.video_url = body.video_url === null ? null : String(body.video_url);
    }
    if (body.video_id !== undefined) {
      updateData.video_id = body.video_id === null ? null : String(body.video_id);
    }

    // v102: summary + objectives
    if (body.summary !== undefined) {
      updateData.summary = body.summary === null ? null : String(body.summary);
    }
    if (body.objectives !== undefined) {
      // objectives is a JSONB array of strings
      if (!Array.isArray(body.objectives)) {
        return NextResponse.json(
          { error: 'objectives must be an array of strings' },
          { status: 400 },
        );
      }
      updateData.objectives = body.objectives;
    }

    // v102: scheduling fields
    if (body.due_date !== undefined) {
      updateData.due_date = body.due_date;  // ISO string or null
    }
    if (body.available_from !== undefined) {
      updateData.available_from = body.available_from;
    }
    if (body.available_until !== undefined) {
      updateData.available_until = body.available_until;
    }

    // v102: prerequisite
    if (body.prerequisite_lesson_id !== undefined) {
      updateData.prerequisite_lesson_id = body.prerequisite_lesson_id === null
        ? null
        : String(body.prerequisite_lesson_id);
    }

    // v102: duration
    if (body.duration_seconds !== undefined) {
      if (body.duration_seconds !== null && typeof body.duration_seconds !== 'number') {
        return NextResponse.json(
          { error: 'duration_seconds must be a number (or null)' },
          { status: 400 },
        );
      }
      updateData.duration_seconds = body.duration_seconds;
    }

    // v102: tags (array of strings)
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        return NextResponse.json(
          { error: 'tags must be an array of strings' },
          { status: 400 },
        );
      }
      updateData.tags = body.tags.filter((t: unknown) => typeof t === 'string');
    }

    // v102: free preview flag
    if (body.is_free_preview !== undefined) {
      updateData.is_free_preview = !!body.is_free_preview;
    }

    // v102: instructor notes
    if (body.instructor_notes !== undefined) {
      updateData.instructor_notes = body.instructor_notes === null ? null : String(body.instructor_notes);
    }

    // v102: transcript
    if (body.transcript !== undefined) {
      updateData.transcript = body.transcript === null ? null : String(body.transcript);
    }

    // v100: estimated_minutes
    if (body.estimated_minutes !== undefined) {
      if (body.estimated_minutes !== null && typeof body.estimated_minutes !== 'number') {
        return NextResponse.json(
          { error: 'estimated_minutes must be a number (or null)' },
          { status: 400 },
        );
      }
      updateData.estimated_minutes = body.estimated_minutes;
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
      // v99: friendlier error message that hints at the likely root cause
      // (missing v63 columns: unit_id, order_within_unit, pass_threshold).
      // If the migration v99 (or v63) hasn't been applied, UPDATE on these
      // columns fails with a PostgREST error mentioning the missing column.
      const hintMessage = updateError.message?.includes('column')
        ? `Failed to update lesson — schema mismatch. Run migration v99_lessons_v63_columns.sql to add the missing columns. Detail: ${updateError.message}`
        : 'Failed to update lesson';
      return NextResponse.json(
        { error: hintMessage },
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
