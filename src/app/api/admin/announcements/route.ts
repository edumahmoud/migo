import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// GET /api/admin/announcements - list all announcements
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { data, error } = await supabaseServer
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet (migration not run)
      console.error('Error fetching announcements:', error);
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Fetch announcements error:', error);
    return NextResponse.json({ success: true, data: [] });
  }
}

// POST /api/admin/announcements - create announcement
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { title, content, priority, created_by } = body;

    if (!title || !content) {
      return NextResponse.json(
        { success: false, error: 'العنوان والمحتوى مطلوبان' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseServer
      .from('announcements')
      .insert({
        title,
        content,
        priority: priority || 'normal',
        created_by,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating announcement:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء إنشاء الإعلان' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Create announcement error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/announcements - update announcement
export async function PATCH(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { id, title, content, priority, is_active } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرف الإعلان مطلوب' },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (priority !== undefined) updates.priority = priority;
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await supabaseServer
      .from('announcements')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error('Error updating announcement:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء تحديث الإعلان' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update announcement error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/announcements - delete announcement
export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرف الإعلان مطلوب' },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from('announcements')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting announcement:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حذف الإعلان' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete announcement error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
