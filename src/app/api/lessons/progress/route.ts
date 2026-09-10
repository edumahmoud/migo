import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import type { LessonProgress } from '@/lib/types';

/**
 * GET /api/lessons/progress?subject_id=xxx&student_id=yyy&unit_id=zzz
 *
 * - Students: get their own progress
 * - Teachers/admins: get progress for all students in their subject (optionally filtered by student_id, unit_id)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get('subject_id');
    const studentId = searchParams.get('student_id');
    const unitId = searchParams.get('unit_id');
    const lessonId = searchParams.get('lesson_id');

    if (!subjectId) {
      return NextResponse.json({ error: 'subject_id is required' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const isTeacherOrAdmin = role === 'teacher' || role === 'admin' || role === 'superadmin';

    // For students, force student_id = their own id
    const effectiveStudentId = isTeacherOrAdmin ? studentId : userId;

    // Access check
    if (!isTeacherOrAdmin) {
      const { data: enrollment } = await supabaseServer
        .from('subject_students')
        .select('status')
        .eq('subject_id', subjectId)
        .eq('student_id', userId)
        .maybeSingle();
      if (!enrollment || enrollment.status !== 'approved') {
        return NextResponse.json({ error: 'You do not have access to this subject' }, { status: 403 });
      }
    } else {
      const isAdmin = role === 'admin' || role === 'superadmin';
      if (!isAdmin) {
        const { data: subject } = await supabaseServer
          .from('subjects')
          .select('teacher_id')
          .eq('id', subjectId)
          .maybeSingle();
        if (!subject) return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
        if (subject.teacher_id !== userId) {
          const { data: coTeacher } = await supabaseServer
            .from('subject_teachers')
            .select('id')
            .eq('subject_id', subjectId)
            .eq('teacher_id', userId)
            .maybeSingle();
          if (!coTeacher) {
            return NextResponse.json({ error: 'You do not have access to this subject' }, { status: 403 });
          }
        }
      }
    }

    // Build query
    let query = supabaseServer
      .from('lesson_progress')
      .select(`
        *,
        lesson:lessons(title),
        unit:lesson_units(title),
        student:users(name, email, avatar_url)
      `)
      .eq('subject_id', subjectId)
      .order('last_accessed_at', { ascending: false });

    if (effectiveStudentId) query = query.eq('student_id', effectiveStudentId);
    if (unitId) query = query.eq('unit_id', unitId);
    if (lessonId) query = query.eq('lesson_id', lessonId);

    const { data: progress, error } = await query;
    if (error) {
      console.error('[LessonProgress API] Fetch error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 500 });
    }

    // Flatten joined fields for convenience
    const enriched = (progress || []).map((p: any) => ({
      ...p,
      lesson_title: p.lesson?.title,
      unit_title: p.unit?.title,
      student_name: p.student?.name,
      student_email: p.student?.email,
      student_avatar: p.student?.avatar_url,
    })) as LessonProgress[];

    return NextResponse.json({ progress: enriched });
  } catch (error) {
    console.error('[LessonProgress API] GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/lessons/progress
 *
 * Upsert student progress for a lesson.
 * Students can only upsert their own progress.
 *
 * Body: {
 *   lesson_id, subject_id, unit_id?, status, score?, max_score?,
 *   score_percentage?, attempts?, failed_attempts?, time_spent_sec?,
 *   last_position?, failure_points?, started_at?, completed_at?
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const body = await request.json();
    const {
      lesson_id,
      subject_id,
      unit_id,
      status,
      score,
      max_score,
      score_percentage,
      attempts,
      failed_attempts,
      time_spent_sec,
      last_position,
      failure_points,
      started_at,
      completed_at,
    } = body;

    if (!lesson_id || !subject_id) {
      return NextResponse.json({ error: 'lesson_id and subject_id are required' }, { status: 400 });
    }

    const role = await getUserRole(userId);
    const isTeacherOrAdmin = role === 'teacher' || role === 'admin' || role === 'superadmin';

    // Students can only update their own progress; teachers can update on behalf of students (rarely used)
    const targetStudentId = isTeacherOrAdmin && body.student_id ? body.student_id : userId;

    if (!isTeacherOrAdmin) {
      // Verify student is enrolled
      const { data: enrollment } = await supabaseServer
        .from('subject_students')
        .select('status')
        .eq('subject_id', subject_id)
        .eq('student_id', userId)
        .maybeSingle();
      if (!enrollment || enrollment.status !== 'approved') {
        return NextResponse.json({ error: 'You do not have access to this subject' }, { status: 403 });
      }
    }

    // Validate status
    const validStatuses = ['not_started', 'in_progress', 'completed', 'failed', 'locked'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Build the upsert payload
    const payload: Record<string, unknown> = {
      student_id: targetStudentId,
      lesson_id,
      subject_id,
      last_accessed_at: new Date().toISOString(),
    };
    if (unit_id !== undefined) payload.unit_id = unit_id;
    if (status) payload.status = status;
    if (score !== undefined) payload.score = score;
    if (max_score !== undefined) payload.max_score = max_score;
    if (score_percentage !== undefined) payload.score_percentage = score_percentage;
    if (attempts !== undefined) payload.attempts = attempts;
    if (failed_attempts !== undefined) payload.failed_attempts = failed_attempts;
    if (time_spent_sec !== undefined) payload.time_spent_sec = time_spent_sec;
    if (last_position !== undefined) payload.last_position = last_position;
    if (failure_points !== undefined) payload.failure_points = failure_points;
    if (started_at !== undefined) payload.started_at = started_at;
    if (completed_at !== undefined) payload.completed_at = completed_at;

    // If status is 'in_progress' and started_at is null, set it
    if (status === 'in_progress' && !started_at) {
      payload.started_at = new Date().toISOString();
    }

    // If status is 'completed' and completed_at is null, set it
    if (status === 'completed' && !completed_at) {
      payload.completed_at = new Date().toISOString();
    }

    // Upsert (UNIQUE constraint on student_id + lesson_id)
    const { data: upserted, error: upsertError } = await supabaseServer
      .from('lesson_progress')
      .upsert(payload, { onConflict: 'student_id,lesson_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('[LessonProgress API] Upsert error:', upsertError.message);
      return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
    }

    return NextResponse.json({ progress: upserted as LessonProgress });
  } catch (error) {
    console.error('[LessonProgress API] POST unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
