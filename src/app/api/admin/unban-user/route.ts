import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, banId } = body;

    if (!email && !banId) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني أو معرف الحظر مطلوب' },
        { status: 400 }
      );
    }

    // Deactivate the ban instead of deleting it (preserves history)
    let query = supabaseServer
      .from('banned_users')
      .update({ is_active: false });

    if (banId) {
      query = query.eq('id', banId);
    } else {
      query = query.eq('email', email);
    }

    const { error } = await query;

    if (error) {
      console.error('Error unbanning user:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء إلغاء الحظر' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unban user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
