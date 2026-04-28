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
      .select('id, file_id, shared_by, shared_with, permission, created_at')
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

      // Fetch all other recipients this file is shared with (excluding current user)
      const { data: allFileShares } = await supabaseServer
        .from('file_shares')
        .select('id, shared_with, permission')
        .eq('file_id', share.file_id)
        .neq('shared_with', user.id);

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
