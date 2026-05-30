import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// -------------------------------------------------------
// POST /api/subject-pause — Toggle subject pause/activate
// Body: { subjectId, isPaused }
// -------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { subjectId, isPaused } = body;

    if (!subjectId) {
      return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    }

    if (typeof isPaused !== 'boolean') {
      return NextResponse.json({ error: 'isPaused must be a boolean' }, { status: 400 });
    }

    // Verify the user is the teacher or a co-teacher of this subject
    const { data: subject, error: fetchError } = await supabaseServer
      .from('subjects')
      .select('teacher_id')
      .eq('id', subjectId)
      .single();

    if (fetchError || !subject) {
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 });
    }

    // Check if user is the main teacher
    if (subject.teacher_id === authResult.user.id) {
      // Allowed
    } else {
      // Check if user is a co-teacher
      const { data: coTeacher } = await supabaseServer
        .from('subject_teachers')
        .select('id')
        .eq('subject_id', subjectId)
        .eq('teacher_id', authResult.user.id)
        .single();

      if (!coTeacher) {
        return NextResponse.json({ error: 'Only the teacher can pause/activate this subject' }, { status: 403 });
      }
    }

    const { error } = await supabaseServer
      .from('subjects')
      .update({ is_paused: isPaused, updated_at: new Date().toISOString() })
      .eq('id', subjectId);

    if (error) {
      console.error('Error toggling subject pause:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, isPaused });
  } catch (err) {
    console.error('POST /api/subject-pause error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
