import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null;

    // Method 1: Try cookie-based auth using getSession() which handles token refresh
    // (getUser() alone may fail if the access token in cookies is expired and
    //  the internal refresh doesn't propagate back to the cookie store in API routes)
    try {
      const serverClient = await getSupabaseServerClient();
      const { data: { session }, error: sessionError } = await serverClient.auth.getSession();
      if (!sessionError && session?.user) {
        userId = session.user.id;
      }
    } catch {
      // Cookie-based auth failed, try token-based
    }

    // Method 2: Try Authorization header token (works on mobile browsers)
    if (!userId) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
          if (supabaseUrl && supabaseAnonKey) {
            const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
              auth: { autoRefreshToken: false, persistSession: false },
              global: { headers: { Authorization: `Bearer ${token}` } },
            });
            const { data: { user }, error } = await tokenClient.auth.getUser(token);
            if (!error && user) {
              userId = user.id;
            }
          }
        } catch {
          // Token-based auth also failed
        }
      }
    }

    // Method 3: Use x-user-id header set by middleware (already authenticated)
    // The middleware validates the user before the request reaches this API route,
    // so x-user-id is a reliable fallback when cookie/header auth fails in the route handler.
    if (!userId) {
      const middlewareUserId = request.headers.get('x-user-id');
      if (middlewareUserId) {
        userId = middlewareUserId;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client to bypass RLS on file_shares
    const { data: shares, error } = await supabaseServer
      .from('file_shares')
      .select('id, file_id, shared_by, shared_with, permission, created_at')
      .eq('shared_with', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch shares' }, { status: 500 });
    }

    const enriched = [];
    for (const share of (shares || [])) {
      const { data: fileData } = await supabaseServer
        .from('user_files')
        .select('*')
        .eq('id', share.file_id)
        .single();

      const { data: sharerProfile } = await supabaseServer
        .from('users')
        .select('id, name, avatar_url, role, title_id, gender')
        .eq('id', share.shared_by)
        .single();

      // Fetch all other recipients this file is shared with (excluding current user)
      const { data: allFileShares } = await supabaseServer
        .from('file_shares')
        .select('id, shared_with, permission')
        .eq('file_id', share.file_id)
        .neq('shared_with', userId);

      const otherRecipients: { id: string; name: string; avatar_url: string | null; role: string; title_id: string | null; gender: string | null; permission: string }[] = [];
      if (allFileShares && allFileShares.length > 0) {
        // Batch fetch user profiles for all recipients
        const recipientIds = allFileShares.map((s) => s.shared_with);
        const { data: recipientProfiles } = await supabaseServer
          .from('users')
          .select('id, name, avatar_url, role, title_id, gender')
          .in('id', recipientIds);

        if (recipientProfiles) {
          const profileMap = new Map(recipientProfiles.map((p) => [p.id, p]));
          for (const fs of allFileShares) {
            const rp = profileMap.get(fs.shared_with);
            if (rp) {
              otherRecipients.push({
                id: rp.id,
                name: rp.name,
                avatar_url: rp.avatar_url,
                role: rp.role,
                title_id: rp.title_id,
                gender: rp.gender,
                permission: fs.permission,
              });
            }
          }
        }
      }

      if (fileData) {
        enriched.push({
          ...fileData,
          shared_by_user: sharerProfile || undefined,
          shared_at: share.created_at,
          permission: share.permission,
          other_recipients: otherRecipients,
          total_recipients_count: (allFileShares?.length || 0) + 1, // +1 for current user
        });
      }
    }

    return NextResponse.json({ shares: enriched });
  } catch (error) {
    console.error('Fetch shared files error:', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
