import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// =====================================================
// GET /api/admin/flagged-comments
//   Returns all flagged video comments.
//   Admin/superadmin only.
// =====================================================
// DELETE /api/admin/flagged-comments?comment_id=XXX
//   Deletes a flagged comment by ID.
//   Admin/superadmin only.
// =====================================================

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    // Fetch flagged comments
    const { data: comments, error } = await supabaseServer
      .from('video_comments')
      .select('*')
      .eq('is_flagged', true)
      .order('flagged_at', { ascending: false });

    if (error) {
      console.error('[flagged-comments] GET error:', error.message);
      return NextResponse.json({ success: false, error: 'فشل جلب التعليقات المبلّغة' }, { status: 500 });
    }

    // Enrich with user names + video titles (batch fetch)
    const commentList = (comments || []) as Array<Record<string, unknown>>;
    if (commentList.length === 0) {
      return NextResponse.json({ success: true, comments: [] });
    }

    // Fetch video titles
    const videoIds = [...new Set(commentList.map((c) => c.video_id).filter(Boolean))] as string[];
    const videoMap = new Map<string, { id: string; title: string }>();
    if (videoIds.length > 0) {
      const { data: videoData } = await supabaseServer
        .from('subject_videos')
        .select('id, title')
        .in('id', videoIds);
      if (videoData) {
        for (const v of videoData as Array<{ id: string; title: string }>) {
          videoMap.set(v.id, v);
        }
      }
    }

    // Fetch user names
    const userIds = [...new Set(commentList.map((c) => c.user_id).filter(Boolean))] as string[];
    const userMap = new Map<string, { id: string; name: string | null; role: string | null; gender: string | null; title_id: string | null }>();
    if (userIds.length > 0) {
      const { data: users } = await supabaseServer
        .from('users')
        .select('id, name, role, gender, title_id')
        .in('id', userIds);
      if (users) {
        for (const u of users as Array<{ id: string; name: string | null; role: string | null; gender: string | null; title_id: string | null }>) {
          userMap.set(u.id, u);
        }
      }
    }

    const enriched = commentList.map((c) => {
      const user = c.user_id ? userMap.get(c.user_id as string) : null;
      const video = c.video_id ? videoMap.get(c.video_id as string) : null;
      return {
        ...c,
        user_name: user?.name || null,
        user_role: user?.role || null,
        user_gender: user?.gender || null,
        user_title_id: user?.title_id || null,
        video_title: video?.title || null,
      };
    });

    return NextResponse.json({ success: true, comments: enriched });
  } catch (error) {
    console.error('[flagged-comments] GET unexpected:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const commentId = request.nextUrl.searchParams.get('comment_id');

    if (!commentId) {
      return NextResponse.json(
        { success: false, error: 'معرف التعليق مطلوب' },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from('video_comments')
      .delete()
      .eq('id', commentId);

    // Treat "no rows" as success (already deleted)
    if (error && !error.message.includes('no rows') && error.code !== 'PGRST116') {
      console.error('[flagged-comments] DELETE error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل حذف التعليق' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[flagged-comments] DELETE unexpected:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

// =====================================================
// PATCH /api/admin/flagged-comments
//   Body: { comment_id: string, action: 'unflag' }
//   Unflags a comment (sets is_flagged=false).
//   Admin/superadmin only.
// =====================================================
export async function PATCH(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { comment_id, action } = body;

    if (!comment_id) {
      return NextResponse.json({ success: false, error: 'معرف التعليق مطلوب' }, { status: 400 });
    }

    if (action === 'unflag') {
      const { error } = await supabaseServer
        .from('video_comments')
        .update({ is_flagged: false, flagged_at: null, flagged_by: null })
        .eq('id', comment_id);

      if (error) {
        console.error('[flagged-comments] PATCH unflag error:', error.message);
        return NextResponse.json({ success: false, error: 'فشل إلغاء التبليغ' }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error) {
    console.error('[flagged-comments] PATCH unexpected:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
