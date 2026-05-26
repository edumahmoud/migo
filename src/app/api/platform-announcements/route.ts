import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getCache, setCache, isCacheValid } from '@/lib/platform-announcements-cache';

// GET /api/platform-announcements - get active platform announcements (no auth required)
export async function GET() {
  try {
    // Return cached result if still fresh
    if (isCacheValid()) {
      const cached = getCache();
      return NextResponse.json({ success: true, data: cached!.data });
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseServer
      .from('platform_announcements')
      .select('id, title, message, title_en, message_en, type, image_url, bg_color, icon, display_location, display_size, start_at, end_at, created_at')
      .eq('is_active', true)
      .lte('start_at', now)
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet (migration not run) - cache empty result to avoid repeated failures
      console.error('Error fetching platform announcements:', error);
      setCache([]);
      return NextResponse.json({ success: true, data: [] });
    }

    // Filter out announcements that have ended (end_at IS NOT NULL AND end_at <= now)
    const activeData = (data || []).filter(
      (item: Record<string, unknown>) => item.end_at === null || (item.end_at as string) > now
    );

    setCache(activeData);
    return NextResponse.json({ success: true, data: activeData });
  } catch {
    // Gracefully handle any unexpected errors
    return NextResponse.json({ success: true, data: [] });
  }
}

// POST /api/platform-announcements - track a view for a platform announcement
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { announcement_id, user_id } = body;

    if (!announcement_id) {
      return NextResponse.json(
        { success: false, error: 'announcement_id is required' },
        { status: 400 }
      );
    }

    // Insert view record
    const { error: viewError } = await supabaseServer
      .from('platform_announcement_views')
      .insert({
        announcement_id,
        user_id: user_id || null,
        viewed_at: new Date().toISOString(),
      });

    if (viewError) {
      // Table may not exist yet - log but don't fail
      console.error('Error inserting platform announcement view:', viewError);
    }

    // Increment views_count on the announcement
    const { error: updateError } = await supabaseServer.rpc('increment_platform_announcement_views', {
      announcement_id_input: announcement_id,
    });

    if (updateError) {
      // Fallback: try manual increment if RPC doesn't exist
      const { data: current } = await supabaseServer
        .from('platform_announcements')
        .select('views_count')
        .eq('id', announcement_id)
        .single();

      if (current) {
        await supabaseServer
          .from('platform_announcements')
          .update({ views_count: (current.views_count || 0) + 1 })
          .eq('id', announcement_id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track platform announcement view error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
