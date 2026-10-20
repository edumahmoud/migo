import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';
import { isValidIdentity, isValidMode } from '@/stores/theme-store';

/**
 * GET /api/user/preferences
 *   Returns the current user's theme preferences.
 *   Response: { success: true, preferences: { theme_identity, theme_mode } | null }
 *
 * PUT /api/user/preferences
 *   Body: { theme_identity, theme_mode }
 *   Upserts the user's preferences (creates if not exists, updates if exists).
 *   Response: { success: true, preferences: {...} }
 */

async function getUserId(request: NextRequest): Promise<string | null> {
  // Try x-user-id header first (set by middleware), then fall back to auth.
  const headerUserId = request.headers.get('x-user-id');
  if (headerUserId) return headerUserId;

  const auth = await authenticateRequest(request);
  return auth.success ? auth.user.id : null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseServer
    .from('user_preferences')
    .select('theme_identity, theme_mode')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[user/preferences] GET error:', error);
    return NextResponse.json({ error: 'فشل جلب التفضيلات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, preferences: data ?? null });
}

export async function PUT(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { theme_identity, theme_mode } = body as {
    theme_identity?: string;
    theme_mode?: string;
  };

  if (!theme_identity || !theme_mode) {
    return NextResponse.json({ error: 'theme_identity + theme_mode مطلوبان' }, { status: 400 });
  }

  if (!isValidIdentity(theme_identity)) {
    return NextResponse.json({ error: 'theme_identity غير صالح' }, { status: 400 });
  }

  if (!isValidMode(theme_mode)) {
    return NextResponse.json({ error: 'theme_mode غير صالح' }, { status: 400 });
  }

  // Upsert (insert or update on conflict).
  const { data, error } = await supabaseServer
    .from('user_preferences')
    .upsert(
      { user_id: userId, theme_identity, theme_mode },
      { onConflict: 'user_id' },
    )
    .select('theme_identity, theme_mode')
    .maybeSingle();

  if (error) {
    console.error('[user/preferences] PUT error:', error);
    return NextResponse.json({ error: 'فشل حفظ التفضيلات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, preferences: data });
}
