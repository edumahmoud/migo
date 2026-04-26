import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, reason, banUntil, bannedBy } = body;

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

    // Fetch user email and name
    const { data: userRecord } = await supabaseServer
      .from('users')
      .select('email, name, role')
      .eq('id', userId)
      .single();

    if (!userRecord?.email) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    // Only superadmin can ban admins
    if (userRecord.role === 'admin' && requesterProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه حظر المشرفين' },
        { status: 403 }
      );
    }

    // Cannot ban superadmins
    if (userRecord.role === 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'لا يمكن حظر مدير المنصة' },
        { status: 403 }
      );
    }

    // Check if user already has an active ban
    const { data: existingBan } = await supabaseServer
      .from('banned_users')
      .select('id, is_active')
      .eq('email', userRecord.email)
      .maybeSingle();

    // Old schema: is_active doesn't exist (undefined), treat as active if record exists
    const isExistingActive = existingBan && (existingBan.is_active === undefined || existingBan.is_active === true);

    if (isExistingActive) {
      // Update existing ban
      const updateData: Record<string, unknown> = {
        reason: reason || 'حظر بواسطة المشرف',
        banned_by: bannedBy || null,
        is_active: true,
        user_id: userId,
        banned_at: new Date().toISOString(),
      };

      if (banUntil) {
        updateData.ban_until = banUntil;
      } else {
        // Permanent ban - clear ban_until
        updateData.ban_until = null;
      }

      const { error } = await supabaseServer
        .from('banned_users')
        .update(updateData)
        .eq('id', existingBan.id);

      if (error) {
        console.error('Error updating ban:', error);
        return NextResponse.json(
          { success: false, error: 'حدث خطأ أثناء تحديث الحظر' },
          { status: 500 }
        );
      }
    } else {
      // Create new ban record
      const banData: Record<string, unknown> = {
        email: userRecord.email,
        user_id: userId,
        reason: reason || 'حظر بواسطة المشرف',
        banned_by: bannedBy || null,
        is_active: true,
      };

      if (banUntil) {
        banData.ban_until = banUntil;
      }

      if (existingBan && !isExistingActive) {
        // Reactivate existing inactive ban
        const { error } = await supabaseServer
          .from('banned_users')
          .update(banData)
          .eq('id', existingBan.id);

        if (error) {
          console.error('Error reactivating ban:', error);
          return NextResponse.json(
            { success: false, error: 'حدث خطأ أثناء إعادة تفعيل الحظر' },
            { status: 500 }
          );
        }
      } else {
        // Insert new ban
        const { error } = await supabaseServer
          .from('banned_users')
          .upsert(banData, { onConflict: 'email' });

        if (error) {
          console.error('Error banning user:', error);
          return NextResponse.json(
            { success: false, error: 'حدث خطأ أثناء حظر المستخدم' },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ban user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
