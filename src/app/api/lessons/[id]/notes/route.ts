import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// =====================================================
// GET /api/lessons/[id]/notes
//   Returns the current user's notes for this lesson.
//   Teachers get nothing (notes are student-only).
// =====================================================
// POST /api/lessons/[id]/notes
//   Body: { content: string, position_seconds?: number }
//   Upserts the user's note for this lesson (one per student per lesson).
// =====================================================

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: lessonId } = await params;

    if (!lessonId) return NextResponse.json({ error: 'Lesson ID required' }, { status: 400 });

    const { data: note, error } = await supabaseServer
      .from('lesson_notes')
      .select('id, content, position_seconds, updated_at')
      .eq('lesson_id', lessonId)
      .eq('student_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[Lesson Notes GET] error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch note' }, { status: 500 });
    }

    return NextResponse.json({ note: note || null });
  } catch (err) {
    console.error('[Lesson Notes GET] unexpected:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: lessonId } = await params;

    if (!lessonId) return NextResponse.json({ error: 'Lesson ID required' }, { status: 400 });

    let body: { content?: string; position_seconds?: number | null };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    // Upsert: one note per student per lesson (UNIQUE constraint)
    const upsertPayload = {
      lesson_id: lessonId,
      student_id: userId,
      content: body.content.trim(),
      position_seconds: body.position_seconds ?? null,
    };

    const { data: note, error: upsertErr } = await supabaseServer
      .from('lesson_notes')
      .upsert(upsertPayload, { onConflict: 'lesson_id,student_id' })
      .select('id, content, position_seconds, updated_at')
      .single();

    if (upsertErr) {
      console.error('[Lesson Notes POST] upsert error:', upsertErr.message);
      return NextResponse.json(
        { error: 'Failed to save note. Run v102 migration to create lesson_notes table.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ note });
  } catch (err) {
    console.error('[Lesson Notes POST] unexpected:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: lessonId } = await params;

    if (!lessonId) return NextResponse.json({ error: 'Lesson ID required' }, { status: 400 });

    const { error } = await supabaseServer
      .from('lesson_notes')
      .delete()
      .eq('lesson_id', lessonId)
      .eq('student_id', userId);

    if (error) {
      console.error('[Lesson Notes DELETE] error:', error.message);
      return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Lesson Notes DELETE] unexpected:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
