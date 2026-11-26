import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * POST /api/users/batch
 * Fetch multiple user profiles by their IDs (server-side, bypasses RLS)
 * Body: { userIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }

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

    // Teachers and admins also get the email of student rows (for their student lists and search).
    // Students and other roles never get emails from this route.
    const viewerRole = await getUserRole(authResult.user.id);
    if (users && users.length > 0 && (viewerRole === 'teacher' || viewerRole === 'admin' || viewerRole === 'superadmin')) {
      const studentIds = users.filter((u: any) => u.role === 'student').map((u: any) => u.id);
      if (studentIds.length > 0) {
        const { data: emails } = await supabaseServer.from('users').select('id, email').in('id', studentIds);
        const emailMap = new Map((emails || []).map((e: any) => [e.id, e.email]));
        return NextResponse.json({ users: users.map((u: any) => (emailMap.has(u.id) ? { ...u, email: emailMap.get(u.id) } : u)) });
      }
    }

    return NextResponse.json({ users: users || [] });
  } catch (err) {
    console.error('[users/batch] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
