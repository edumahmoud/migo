import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

// =====================================================
// GET /api/lessons/progress?subject_id=XXX
// =====================================================
// Returns the current user's progress map for ALL lessons in a subject.
// Used by the "محتوى المقرر" tab to:
//   - Show ✓ on completed lessons
//   - Compute per-unit progress bar (%)
//   - Compute overall subject progress (%)
//   - Show "Resume from last lesson" button (uses last_accessed_at)
//
// Returns: {
//   progress: { [lesson_id]: { status, completed_at, last_accessed_at } },
//   lastLessonId: string | null,        // lesson with most recent last_accessed_at
//   totalLessons: number,
//   completedCount: number,
//   progressPercent: number              // 0-100
// }
//
// For teachers/admins, returns empty progress + their lastLessonId = null
// (teachers don't track progress on their own lessons).
// =====================================================

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const role = await getUserRole(userId);
    const subjectId = request.nextUrl.searchParams.get('subject_id');

    if (!subjectId) {
      return NextResponse.json({ error: 'subject_id is required' }, { status: 400 });
    }

    // Teachers/admins don't have student progress on lessons they teach
    if (role === 'teacher' || role === 'admin' || role === 'superadmin') {
      return NextResponse.json({
        progress: {},
        lastLessonId: null,
        totalLessons: 0,
        completedCount: 0,
        progressPercent: 0,
      });
    }

    // Verify enrollment
    const { data: enrollment } = await supabaseServer
      .from('subject_students')
      .select('id')
      .eq('subject_id', subjectId)
      .eq('student_id', userId)
      .maybeSingle();

    if (!enrollment) {
      return NextResponse.json({ error: 'Not enrolled in this subject' }, { status: 403 });
    }

    // Fetch all published lessons in this subject (for the student count)
    const { data: publishedLessons, error: lessonsErr } = await supabaseServer
      .from('lessons')
      .select('id')
      .eq('subject_id', subjectId)
      .eq('status', 'published');

    if (lessonsErr) {
      console.error('[Lessons Progress Batch API] Lessons fetch error:', lessonsErr.message);
      return NextResponse.json({ error: 'Failed to fetch lessons' }, { status: 500 });
    }

    const totalLessons = publishedLessons?.length ?? 0;

    // Fetch this student's progress on all lessons in this subject
    const { data: progressRows, error: progressErr } = await supabaseServer
      .from('lesson_progress')
      .select('lesson_id, status, completed_at, last_accessed_at, started_at')
      .eq('student_id', userId)
      .eq('subject_id', subjectId);

    if (progressErr) {
      console.error('[Lessons Progress Batch API] Progress fetch error:', progressErr.message);
      return NextResponse.json({ error: 'Failed to fetch progress' }, { status: 500 });
    }

    // Build progress map: { lesson_id: { status, completed_at, ... } }
    const progress: Record<string, { status: string; completed_at: string | null; last_accessed_at: string | null; started_at: string | null }> = {};
    let completedCount = 0;
    let lastLessonId: string | null = null;
    let lastAccessedTime: string | null = null;

    for (const row of progressRows || []) {
      progress[row.lesson_id] = {
        status: row.status,
        completed_at: row.completed_at,
        last_accessed_at: row.last_accessed_at,
        started_at: row.started_at,
      };
      if (row.status === 'completed') completedCount++;
      // Track the most recently accessed lesson (for "Resume" button)
      if (row.last_accessed_at && (!lastAccessedTime || row.last_accessed_at > lastAccessedTime)) {
        lastAccessedTime = row.last_accessed_at;
        lastLessonId = row.lesson_id;
      }
    }

    const progressPercent = totalLessons > 0
      ? Math.round((completedCount / totalLessons) * 100)
      : 0;

    return NextResponse.json({
      progress,
      lastLessonId,
      totalLessons,
      completedCount,
      progressPercent,
    });
  } catch (error) {
    console.error('[Lessons Progress Batch API] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
