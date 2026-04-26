import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/users/batch
 * Fetch multiple user profiles by their IDs (server-side, bypasses RLS)
 * Body: { userIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userIds } = body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    // Limit batch size to prevent abuse
    if (userIds.length > 100) {
      return NextResponse.json({ error: 'عدد المستخدمين كبير جداً' }, { status: 400 });
    }

    // Fetch user profiles using service role (bypasses RLS)
    const { data: users, error } = await supabaseServer
      .from('users')
      .select('id, name, username, role, avatar_url, title_id, gender, teacher_code, created_at')
      .in('id', userIds);

    if (error) {
      // If username column doesn't exist, try without it
      if (error.message?.includes('username') || error.code === 'PGRST204') {
        const { data: usersNoUsername, error: fallbackError } = await supabaseServer
          .from('users')
          .select('id, name, role, avatar_url, title_id, gender, teacher_code, created_at')
          .in('id', userIds);

        if (fallbackError) {
          console.error('[users/batch] Error fetching users:', fallbackError);
          return NextResponse.json({ error: 'حدث خطأ أثناء جلب بيانات المستخدمين' }, { status: 500 });
        }

        const mapped = (usersNoUsername || []).map(u => ({ ...u, username: null }));
        return NextResponse.json({ users: mapped });
      }

      console.error('[users/batch] Error fetching users:', error);
      return NextResponse.json({ error: 'حدث خطأ أثناء جلب بيانات المستخدمين' }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (err) {
    console.error('[users/batch] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
