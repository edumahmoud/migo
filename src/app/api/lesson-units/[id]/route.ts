import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import type { LessonUnit } from '@/lib/types';

/**
 * Verify the user has teacher/admin access to the given subject.
 */
async function verifySubjectAccess(userId: string, subjectId: string | null | undefined, role: string | null | undefined) {
  if (!subjectId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Subject ID is required' }, { status: 400 }) };
  }
  const isAdmin = role === 'admin' || role === 'superadmin';
  if (isAdmin) return { ok: true as const };

  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();

  if (!subject) return { ok: false as const, response: NextResponse.json({ error: 'Subject not found' }, { status: 404 }) };
  if (subject.teacher_id === userId) return { ok: true as const };

  const { data: coTeacher } = await supabaseServer
    .from('subject_teachers')
    .select('id')
    .eq('subject_id', subjectId)
    .eq('teacher_id', userId)
    .maybeSingle();

  if (coTeacher) return { ok: true as const };
  return {
    ok: false as const,
    response: NextResponse.json({ error: 'You do not have access to this subject' }, { status: 403 }),
  };
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/lesson-units/[id]
 *
 * Update a unit.
 * Body: { title?, description?, pass_threshold?, is_published?, order_index? }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: unitId } = await params;

    if (!unitId) {
      return NextResponse.json({ error: 'Unit ID is required' }, { status: 400 });
    }

    // Fetch existing
    const { data: existing, error: fetchError } = await supabaseServer
      .from('lesson_units')
      .select('id, subject_id')
      .eq('id', unitId)
      .maybeSingle() as { data: { id: string; subject_id: string } | null; error: any };

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }

    const role = await getUserRole(userId);
    if (!existing.subject_id) {
      return NextResponse.json({ error: 'Unit has no subject' }, { status: 400 });
    }
    const subjectId = existing.subject_id!;
    const access = await verifySubjectAccess(userId, subjectId, role);
    if (!access.ok) return access.response;

    const body = await request.json();
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 });
      }
      updateData.title = body.title.trim();
    }
    if (body.description !== undefined) {
      updateData.description = body.description;
    }
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
    if (body.is_published !== undefined) {
      updateData.is_published = !!body.is_published;
    }
    if (body.order_index !== undefined && typeof body.order_index === 'number') {
      updateData.order_index = body.order_index;
    }

    const fieldsToUpdate = Object.keys(updateData).filter((k) => k !== 'updated_at');
    if (fieldsToUpdate.length === 0) {
      return NextResponse.json({ error: 'At least one field must be provided for update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabaseServer
      .from('lesson_units')
      .update(updateData)
      .eq('id', unitId)
      .select()
      .single();

    if (updateError) {
      console.error('[LessonUnits API] Update error:', updateError.message);
      return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 });
    }

    return NextResponse.json({ unit: updated as LessonUnit });
  } catch (error) {
    console.error('[LessonUnits API] PUT unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/lesson-units/[id]
 *
 * Delete a unit. Lessons assigned to this unit get unit_id set to NULL
 * (ON DELETE SET NULL) but remain in the subject.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: unitId } = await params;

    if (!unitId) {
      return NextResponse.json({ error: 'Unit ID is required' }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabaseServer
      .from('lesson_units')
      .select('id, subject_id')
      .eq('id', unitId)
      .maybeSingle();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }

    const role = await getUserRole(userId);
    if (!existing.subject_id) {
      return NextResponse.json({ error: 'Unit has no subject' }, { status: 400 });
    }
    const subjectId = existing.subject_id!;
    const access = await verifySubjectAccess(userId, subjectId, role);
    if (!access.ok) return access.response;

    const { error: deleteError } = await supabaseServer
      .from('lesson_units')
      .delete()
      .eq('id', unitId);

    if (deleteError) {
      console.error('[LessonUnits API] Delete error:', deleteError.message);
      return NextResponse.json({ error: 'Failed to delete unit' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LessonUnits API] DELETE unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
