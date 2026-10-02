import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

// =====================================================
// POST /api/lessons/[id]/progress
// =====================================================
// Records student progress on a lesson.
//
// Body (all optional — at least one must be provided):
//   { action: 'view' | 'complete' | 'reset' }
//     - 'view'    → marks as 'in_progress' if not yet started (idempotent)
//     - 'complete'→ marks as 'completed' (sets completed_at via trigger)
//     - 'reset'   → reverts to 'not_started' (clears completed_at)
//
// Returns: { progress: { status, completed_at, last_accessed_at, ... } }
//
// Authorization:
//   - Student must be authenticated.
//   - Student must be enrolled in the subject (or be admin/teacher).
//   - RLS policy on lesson_progress ensures students can only write their own rows.
// =====================================================

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const role = await getUserRole(userId);
    const { id: lessonId } = await params;

    if (!lessonId) {
      return NextResponse.json({ error: 'Lesson ID is required' }, { status: 400 });
    }

    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const action = body.action ?? 'view';
    if (!['view', 'complete', 'reset'].includes(action)) {
      return NextResponse.json({ error: 'action must be view | complete | reset' }, { status: 400 });
    }

    // Fetch the lesson to verify it exists and get subject_id + unit_id
    const { data: lesson, error: lessonErr } = await supabaseServer
      .from('lessons')
      .select('id, subject_id, unit_id, status')
      .eq('id', lessonId)
      .maybeSingle();

    if (lessonErr || !lesson) {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }

    const isAdmin = role === 'admin' || role === 'superadmin';
    const isTeacher = role === 'teacher';

    // Verify enrollment (for students)
    if (!isAdmin && !isTeacher) {
      const { data: enrollment } = await supabaseServer
        .from('subject_students')
        .select('id')
        .eq('subject_id', lesson.subject_id)
        .eq('student_id', userId)
        .maybeSingle();
      if (!enrollment) {
        return NextResponse.json({ error: 'Not enrolled in this subject' }, { status: 403 });
      }
    }

    // Determine the new status based on action
    let newStatus: string;
    let completedAt: string | null = null;
    if (action === 'complete') {
      newStatus = 'completed';
      completedAt = new Date().toISOString();
    } else if (action === 'reset') {
      newStatus = 'not_started';
    } else {
      // 'view' — set to in_progress if not yet started or not completed
      newStatus = 'in_progress';
    }

    // Upsert into lesson_progress (UNIQUE student_id + lesson_id ensures no duplicates)
    const upsertPayload = {
      student_id: userId,
      lesson_id: lessonId,
      subject_id: lesson.subject_id,
      unit_id: lesson.unit_id || null,
      status: newStatus,
      completed_at: completedAt,
      last_accessed_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    };

    const { data: progress, error: upsertErr } = await supabaseServer
      .from('lesson_progress')
      .upsert(upsertPayload, { onConflict: 'student_id,lesson_id' })
      .select()
      .single();

    if (upsertErr) {
      console.error('[Lessons Progress API] Upsert error:', upsertErr.message);
      return NextResponse.json(
        { error: 'Failed to record progress. Run v100_lesson_progress_and_estimated_time.sql migration.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ progress });
  } catch (error) {
    console.error('[Lessons Progress API] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =====================================================
// GET /api/lessons/[id]/progress
// =====================================================
// Returns the current user's progress on a single lesson.
// Useful for the lesson viewer to show "✓ Completed" state.
// =====================================================

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: lessonId } = await params;

    if (!lessonId) {
      return NextResponse.json({ error: 'Lesson ID is required' }, { status: 400 });
    }

    const { data: progress, error } = await supabaseServer
      .from('lesson_progress')
      .select('id, status, completed_at, last_accessed_at, started_at, time_spent_sec')
      .eq('student_id', userId)
      .eq('lesson_id', lessonId)
      .maybeSingle();

    if (error) {
      console.error('[Lessons Progress API] GET error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 500 });
    }

    return NextResponse.json({ progress: progress || { status: 'not_started' } });
  } catch (error) {
    console.error('[Lessons Progress API] GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
