import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

// 🔒 SECURITY: Profile viewing requires authentication
// - Any authenticated user can view basic profile info (id, name, avatar, role)
// - Only the profile owner can see email and other sensitive fields
// - File request statuses only shown to authenticated requesters

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  // 🔒 SECURITY: Require authentication to view profiles
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { userId } = await params;
    const authenticatedUserId = authResult.user.id;

    // Determine if viewer is the profile owner or an admin
    const viewerRole = await getUserRole(authenticatedUserId);
    const isOwnProfile = authenticatedUserId === userId;
    const isAdmin = viewerRole === 'admin' || viewerRole === 'superadmin';

    // Fetch user profile - try with username first, fallback without
    let profile = null;
    const { data: profileWithUsername, error: profileError } = await supabaseServer
      .from('users')
      .select('id, name, username, role, avatar_url, title_id, gender, email, created_at')
      .eq('id', userId)
      .single();

    if (profileError) {
      // If username column doesn't exist, try without it
      if (profileError.message?.includes('username') || profileError.code === 'PGRST204') {
        const { data: profileNoUsername, error: fallbackError } = await supabaseServer
          .from('users')
          .select('id, name, role, avatar_url, title_id, gender, email, created_at')
          .eq('id', userId)
          .single();

        if (fallbackError || !profileNoUsername) {
          return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
        }
        profile = { ...profileNoUsername, username: null };
      } else {
        return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
      }
    } else {
      profile = profileWithUsername;
    }

    // 🔒 SECURITY: Strip email for non-owners and non-admins
    if (!isOwnProfile && !isAdmin) {
      delete (profile as Record<string, unknown>).email;
    }

    // Fetch public files
    const { data: publicFiles, error: filesError } = await supabaseServer
      .from('user_files')
      .select('id, file_name, file_type, file_size, created_at')
      .eq('user_id', userId)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false });

    if (filesError) {
      console.error('[profile] Error fetching files:', filesError);
    }

    const files = publicFiles || [];

    // If the requester is viewing someone else's profile, check their file request statuses
    let fileRequestStatuses: Record<string, { status: string; requestId: string }> = {};
    if (!isOwnProfile && files.length > 0) {
      const fileIds = files.map((f: { id: string }) => f.id);
      const { data: myRequests } = await supabaseServer
        .from('file_requests')
        .select('id, file_id, status')
        .eq('requester_id', authenticatedUserId)
        .in('file_id', fileIds);

      if (myRequests && myRequests.length > 0) {
        for (const req of myRequests) {
          fileRequestStatuses[req.file_id] = {
            status: req.status,
            requestId: req.id,
          };
        }
      }
    }

    return NextResponse.json({
      profile,
      publicFiles: files,
      fileRequestStatuses,
    });
  } catch (err) {
    console.error('[profile] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
