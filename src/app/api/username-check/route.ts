import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // Authenticate the request
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }

    const { username, currentUserId } = await request.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'اسم المستخدم مطلوب' }, { status: 400 });
    }

    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (clean.length < 3) {
      return NextResponse.json({ available: false, error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' });
    }
    if (clean.length > 30) {
      return NextResponse.json({ available: false, error: 'اسم المستخدم يجب أن يكون 30 حرف على الأكثر' });
    }

    const { data, error } = await supabaseServer
      .from('users')
      .select('id')
      .eq('username', clean)
      .maybeSingle();

    // If username column doesn't exist yet, it's always available
    if (error && (error.message?.includes('username') || error.code === 'PGRST204')) {
      return NextResponse.json({ available: true });
    }

    if (data && data.id !== currentUserId) {
      return NextResponse.json({ available: false, error: 'اسم المستخدم مستخدم بالفعل' });
    }

    return NextResponse.json({ available: true });
  } catch {
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
