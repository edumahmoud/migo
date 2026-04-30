import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// Cache announcements for 60 seconds to avoid repeated DB queries when table is missing
let announcementsCache: { data: unknown[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000;

// GET /api/announcements - get active announcements for all users
export async function GET() {
  try {
    // Return cached result if still fresh
    if (announcementsCache && Date.now() - announcementsCache.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ success: true, data: announcementsCache.data });
    }

    const { data, error } = await supabaseServer
      .from('announcements')
      .select('id, title, content, priority, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      // Table may not exist yet (migration not run) - cache empty result to avoid repeated failures
      announcementsCache = { data: [], timestamp: Date.now() };
      return NextResponse.json({ success: true, data: [] });
    }

    announcementsCache = { data: data || [], timestamp: Date.now() };
    return NextResponse.json({ success: true, data });
  } catch {
    // Gracefully handle any unexpected errors
    return NextResponse.json({ success: true, data: [] });
  }
}
