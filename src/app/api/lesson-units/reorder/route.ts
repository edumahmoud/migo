import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * POST /api/lesson-units/reorder
 *
 * Reorder units within a subject.
 * Body: { subject_id, ordered_unit_ids: string[] }
 *
 * Updates order_index for each unit to match its position in the array.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const body = await request.json();
    const { subject_id, ordered_unit_ids } = body;

    if (!subject_id) {
      return NextResponse.json({ error: 'subject_id is required' }, { status: 400 });
    }
    if (!Array.isArray(ordered_unit_ids) || ordered_unit_ids.some((id) => typeof id !== 'string')) {
      return NextResponse.json({ error: 'ordered_unit_ids must be an array of strings' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const isAdmin = role === 'admin' || role === 'superadmin';

    // Verify access
    if (!isAdmin) {
      const { data: subject } = await supabaseServer
        .from('subjects')
        .select('teacher_id')
        .eq('id', subject_id)
        .maybeSingle();

      if (!subject) {
        return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
      }
      if (subject.teacher_id !== userId) {
        const { data: coTeacher } = await supabaseServer
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', subject_id)
          .eq('teacher_id', userId)
          .maybeSingle();
        if (!coTeacher) {
          return NextResponse.json({ error: 'You do not have access to this subject' }, { status: 403 });
        }
      }
    }

    // Update each unit's order_index
    const updates = ordered_unit_ids.map((unitId: string, index: number) =>
      supabaseServer
        .from('lesson_units')
        .update({ order_index: index, updated_at: new Date().toISOString() })
        .eq('id', unitId)
        .eq('subject_id', subject_id),
    );

    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error('[LessonUnits Reorder API] Update error:', failed.error.message);
      return NextResponse.json({ error: 'Failed to reorder units' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[LessonUnits Reorder API] POST unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
