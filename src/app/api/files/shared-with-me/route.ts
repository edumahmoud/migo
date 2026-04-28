import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const serverClient = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await serverClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role client to bypass RLS on file_shares
    const { data: shares, error } = await supabaseServer
      .from('file_shares')
      .select('id, file_id, shared_by, permission, created_at')
      .eq('shared_with', user.id)
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

      if (fileData) {
        enriched.push({
          ...fileData,
          shared_by_user: sharerProfile || undefined,
          shared_at: share.created_at,
          permission: share.permission,
        });
      }
    }

    return NextResponse.json({ shares: enriched });
  } catch (error) {
    console.error('Fetch shared files error:', error);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
