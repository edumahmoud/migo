import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * GET /api/auth/me
 * Fetches the current authenticated user's profile using the service role key.
 * This bypasses RLS policies that might block client-side queries.
 * Used by the auth store to reliably fetch user profiles during login/initialization.
 */
export async function GET(request: NextRequest) {
  try {
    // Try Bearer token first (from client-side auth header)
    let authUser = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await supabaseServer.auth.getUser(token);
      if (!error && user) authUser = user;
    }

    // Fallback: try server-side cookie auth
    if (!authUser) {
      try {
        const serverClient = await getSupabaseServerClient();
        const { data: { user }, error } = await serverClient.auth.getUser();
        if (!error && user) authUser = user;
      } catch {
        // Cookie auth might fail in API routes
      }
    }

    if (!authUser) {
      return NextResponse.json({ error: 'غير مسجل الدخول' }, { status: 401 });
    }

    // Fetch user profile using service role (bypasses RLS)
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      // Profile doesn't exist yet - create it from auth metadata
      const userName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';
      const avatarUrl = authUser.user_metadata?.avatar_url || null;

      // Check if this is the first user
      const { count: userCount } = await supabaseServer
        .from('users')
        .select('id', { count: 'exact', head: true });

      const isFirstUser = (userCount ?? 0) === 0;
      const defaultRole = isFirstUser ? 'superadmin' : 'student';

      const { data: newProfile, error: insertError } = await supabaseServer
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email || '',
          name: userName,
          role: defaultRole,
          avatar_url: avatarUrl,
        })
        .select()
        .single();

      if (insertError) {
        // Might be a duplicate key error (race condition with trigger)
        const err = insertError as { code?: string; message?: string };
        if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
          // Try fetching again
          const { data: retryProfile } = await supabaseServer
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();

          if (retryProfile) {
            return NextResponse.json({ profile: retryProfile, isNew: true });
          }
        }
        return NextResponse.json({ error: 'فشل في إنشاء الملف الشخصي' }, { status: 500 });
      }

      return NextResponse.json({ profile: newProfile, isNew: true });
    }

    // Check ban status
    const { data: bannedRecord } = await supabaseServer
      .from('banned_users')
      .select('id, reason, banned_at, ban_until, is_active')
      .eq('email', profile.email)
      .maybeSingle();

    let banInfo = null;
    if (bannedRecord) {
      const isActive = bannedRecord.is_active === undefined || bannedRecord.is_active === true;
      const isExpired = bannedRecord.ban_until && new Date(bannedRecord.ban_until) <= new Date();

      if (isActive && !isExpired) {
        banInfo = {
          reason: bannedRecord.reason,
          bannedAt: bannedRecord.banned_at,
          banUntil: bannedRecord.ban_until,
          isPermanent: !bannedRecord.ban_until,
        };
      }
    }

    // Clean up corrupted avatar_url (if it contains institution logo path)
    if (profile.avatar_url && (
      profile.avatar_url.includes('/institution/logos/') ||
      profile.avatar_url.includes('/institution%2Flogos%2F')
    )) {
      // This avatar_url was corrupted by the old /api/avatar endpoint being used for institution logos
      // Clear it so the user sees their initials instead of the institution logo
      await supabaseServer
        .from('users')
        .update({ avatar_url: null })
        .eq('id', authUser.id);
      profile.avatar_url = null;
    }

    return NextResponse.json({ profile, banInfo });
  } catch (err) {
    console.error('[auth/me] Error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
