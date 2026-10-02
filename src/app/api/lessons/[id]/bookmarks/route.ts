import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// =====================================================
// GET /api/lessons/[id]/bookmarks
//   Returns all bookmarks the current user has on this lesson.
// POST /api/lessons/[id]/bookmarks
//   Body: { label?: string, position_seconds?: number }
//   Creates a new bookmark (multiple per lesson allowed).
// DELETE /api/lessons/[id]/bookmarks?bookmark_id=XXX
//   Removes a single bookmark by ID.
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

    const { data: bookmarks, error } = await supabaseServer
      .from('lesson_bookmarks')
      .select('id, label, position_seconds, created_at')
      .eq('lesson_id', lessonId)
      .eq('student_id', userId)
      .order('position_seconds', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('[Lesson Bookmarks GET] error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 });
    }

    return NextResponse.json({ bookmarks: bookmarks || [] });
  } catch (err) {
    console.error('[Lesson Bookmarks GET] unexpected:', err);
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

    let body: { label?: string; position_seconds?: number | null };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const insertPayload = {
      lesson_id: lessonId,
      student_id: userId,
      label: body.label?.trim() || null,
      position_seconds: body.position_seconds ?? null,
    };

    const { data: bookmark, error } = await supabaseServer
      .from('lesson_bookmarks')
      .insert(insertPayload)
      .select('id, label, position_seconds, created_at')
      .single();

    if (error) {
      console.error('[Lesson Bookmarks POST] error:', error.message);
      return NextResponse.json(
        { error: 'Failed to create bookmark. Run v102 migration to create lesson_bookmarks table.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (err) {
    console.error('[Lesson Bookmarks POST] unexpected:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { id: lessonId } = await params;
    const bookmarkId = request.nextUrl.searchParams.get('bookmark_id');

    if (!lessonId || !bookmarkId) {
      return NextResponse.json({ error: 'lesson_id + bookmark_id required' }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from('lesson_bookmarks')
      .delete()
      .eq('id', bookmarkId)
      .eq('lesson_id', lessonId)
      .eq('student_id', userId);

    if (error) {
      console.error('[Lesson Bookmarks DELETE] error:', error.message);
      return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Lesson Bookmarks DELETE] unexpected:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
