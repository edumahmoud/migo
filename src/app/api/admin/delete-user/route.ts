import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

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

    // Verify the requester is authenticated - try Bearer token first, then cookie auth
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
      } catch {
        // Cookie auth failed
      }
    }

    if (!authUser) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    // Verify the requester is admin or superadmin
    const { data: requesterProfile } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .single();

    if (!requesterProfile || (requesterProfile.role !== 'admin' && requesterProfile.role !== 'superadmin')) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بهذا الإجراء' },
        { status: 403 }
      );
    }

    // First, fetch the user's email before deleting
    const { data: userRecord } = await supabaseServer
      .from('users')
      .select('email, role')
      .eq('id', userId)
      .single();

    // Only superadmin can delete admins
    if (userRecord?.role === 'admin' && requesterProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه حذف المشرفين' },
        { status: 403 }
      );
    }

    // Cannot delete superadmins
    if (userRecord?.role === 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'لا يمكن حذف مدير المنصة' },
        { status: 403 }
      );
    }

    const userEmail = userRecord?.email;

    // Delete the user from the users table
    const { error } = await supabaseServer
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Error deleting user:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حذف المستخدم' },
        { status: 500 }
      );
    }

    // Add the user's email to banned_users to prevent re-registration
    if (userEmail) {
      const { error: banError } = await supabaseServer
        .from('banned_users')
        .upsert(
          { email: userEmail, reason: 'تم الحذف بواسطة المشرف' },
          { onConflict: 'email' }
        );

      if (banError) {
        console.error('Error adding to banned_users:', banError);
        // Non-critical: user is already deleted, just log the error
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
