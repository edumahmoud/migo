import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

// Auth helper
async function getAuthUser(request: Request) {
  let authUser = null;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabaseServer.auth.getUser(token);
    if (!error && user) authUser = user;
  }
  if (!authUser) {
    try {
      const serverClient = await getSupabaseServerClient();
      const { data: { user }, error } = await serverClient.auth.getUser();
      if (!error && user) authUser = user;
    } catch {}
  }
  return authUser;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const authUser = await getAuthUser(request);

    // Fetch user profile - try with username first, fallback without
    let profile = null;
    const { data: profileWithUsername, error: profileError } = await supabaseServer
      .from('users')
      .select('id, name, username, role, avatar_url, title_id, gender, created_at')
      .eq('id', userId)
      .single();

    if (profileError) {
      // If username column doesn't exist, try without it
      if (profileError.message?.includes('username') || profileError.code === 'PGRST204') {
        const { data: profileNoUsername, error: fallbackError } = await supabaseServer
          .from('users')
          .select('id, name, role, avatar_url, title_id, gender, created_at')
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
    if (authUser && authUser.id !== userId && files.length > 0) {
      const fileIds = files.map((f: { id: string }) => f.id);
      const { data: myRequests } = await supabaseServer
        .from('file_requests')
        .select('id, file_id, status')
        .eq('requester_id', authUser.id)
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
