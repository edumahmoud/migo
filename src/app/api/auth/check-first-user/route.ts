import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/check-first-user
 * Checks if the given user is the first user on the platform.
 * If so, promotes them to 'superadmin'.
 * This is called after successful registration (email+password or Google OAuth).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // Count total users in the platform using service role
    const { count, error: countError } = await supabaseServer
      .from('users')
      .select('id', { count: 'exact', head: true });

    if (countError) {
      console.error('Error counting users:', countError);
      return NextResponse.json(
        { success: false, error: 'خطأ في التحقق من عدد المستخدمين' },
        { status: 500 }
      );
    }

    // If this is the first (and only) user, promote to superadmin
    if (count === 1) {
      const { data, error: updateError } = await supabaseServer
        .from('users')
        .update({ role: 'superadmin', updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('Error promoting first user to superadmin:', updateError);
        return NextResponse.json(
          { success: false, error: 'خطأ في ترقية الحساب' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        promoted: true,
        role: 'superadmin',
        user: data,
      });
    }

    // Not the first user - no promotion needed
    return NextResponse.json({
      success: true,
      promoted: false,
      role: null,
    });
  } catch (error) {
    console.error('Check first user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
