import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { invalidateCache } from '@/lib/platform-announcements-cache';

// GET /api/admin/platform-announcements - list all platform announcements
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { data, error } = await supabaseServer
      .from('platform_announcements')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet (migration not run)
      console.error('Error fetching platform announcements:', error);
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Fetch platform announcements error:', error);
    return NextResponse.json({ success: true, data: [] });
  }
}

// POST /api/admin/platform-announcements - create platform announcement
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const {
      title,
      message,
      title_en,
      message_en,
      type,
      image_url,
      bg_color,
      icon,
      display_location,
      display_size,
      start_at,
      end_at,
      created_by,
    } = body;

    if (!title || !message) {
      return NextResponse.json(
        { success: false, error: 'Title and message are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseServer
      .from('platform_announcements')
      .insert({
        title,
        message,
        title_en: title_en || null,
        message_en: message_en || null,
        type: type || 'info',
        image_url: image_url || null,
        bg_color: bg_color || null,
        icon: icon || null,
        display_location: display_location || 'all',
        display_size: display_size || 'normal',
        start_at: start_at || new Date().toISOString(),
        end_at: end_at || null,
        created_by,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating platform announcement:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to create platform announcement' },
        { status: 500 }
      );
    }

    // Invalidate public API cache so new announcement is visible immediately
    invalidateCache();

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Create platform announcement error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/platform-announcements - update platform announcement
export async function PATCH(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const {
      id,
      title,
      message,
      title_en,
      message_en,
      type,
      image_url,
      bg_color,
      icon,
      display_location,
      display_size,
      start_at,
      end_at,
      is_active,
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Platform announcement ID is required' },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (message !== undefined) updates.message = message;
    if (title_en !== undefined) updates.title_en = title_en;
    if (message_en !== undefined) updates.message_en = message_en;
    if (type !== undefined) updates.type = type;
    if (image_url !== undefined) updates.image_url = image_url;
    if (bg_color !== undefined) updates.bg_color = bg_color;
    if (icon !== undefined) updates.icon = icon;
    if (display_location !== undefined) updates.display_location = display_location;
    if (display_size !== undefined) updates.display_size = display_size;
    if (start_at !== undefined) updates.start_at = start_at;
    if (end_at !== undefined) updates.end_at = end_at;
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await supabaseServer
      .from('platform_announcements')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error('Error updating platform announcement:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to update platform announcement' },
        { status: 500 }
      );
    }

    // Invalidate public API cache so updated announcement is visible immediately
    invalidateCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update platform announcement error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/platform-announcements - delete platform announcement
export async function DELETE(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Platform announcement ID is required' },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from('platform_announcements')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting platform announcement:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to delete platform announcement' },
        { status: 500 }
      );
    }

    // Invalidate public API cache so deleted announcement is removed immediately
    invalidateCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete platform announcement error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
