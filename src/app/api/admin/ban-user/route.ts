import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

// ─── Schema detection cache ───
// The banned_users table may or may not have enhanced columns
// (ban_until, is_active, user_id, banned_by) depending on whether
// the v15 migration has been applied. We detect once and cache.
let _hasEnhancedSchema: boolean | null = null;

async function hasEnhancedBanSchema(): Promise<boolean> {
  if (_hasEnhancedSchema !== null) return _hasEnhancedSchema;

  try {
    const { error } = await supabaseServer
      .from('banned_users')
      .select('id, ban_until, is_active, user_id, banned_by')
      .limit(1);

    _hasEnhancedSchema = !error;
  } catch {
    _hasEnhancedSchema = false;
  }

  return _hasEnhancedSchema;
}

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

    // Detect schema capabilities
    const isEnhanced = await hasEnhancedBanSchema();

    if (isEnhanced) {
      // ─── Enhanced schema: full ban with duration and status tracking ───
      const { data: existingBan } = await supabaseServer
        .from('banned_users')
        .select('id, is_active')
        .eq('email', userRecord.email)
        .maybeSingle();

      const isExistingActive = existingBan && (existingBan.is_active === undefined || existingBan.is_active === true);

      if (isExistingActive) {
        // Update existing active ban
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
          updateData.ban_until = null;
        }

        const { error } = await supabaseServer
          .from('banned_users')
          .update(updateData)
          .eq('id', existingBan.id);

        if (error) {
          console.error('Error updating ban:', error);
          // Reset schema cache in case schema changed
          _hasEnhancedSchema = null;
          return NextResponse.json(
            { success: false, error: 'حدث خطأ أثناء تحديث الحظر' },
            { status: 500 }
          );
        }
      } else if (existingBan && !isExistingActive) {
        // Reactivate existing inactive ban
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
          updateData.ban_until = null;
        }

        const { error } = await supabaseServer
          .from('banned_users')
          .update(updateData)
          .eq('id', existingBan.id);

        if (error) {
          console.error('Error reactivating ban:', error);
          _hasEnhancedSchema = null;
          return NextResponse.json(
            { success: false, error: 'حدث خطأ أثناء إعادة تفعيل الحظر' },
            { status: 500 }
          );
        }
      } else {
        // Insert new ban
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

        const { error } = await supabaseServer
          .from('banned_users')
          .upsert(banData, { onConflict: 'email' });

        if (error) {
          console.error('Error banning user:', error);
          _hasEnhancedSchema = null;
          return NextResponse.json(
            { success: false, error: 'حدث خطأ أثناء حظر المستخدم' },
            { status: 500 }
          );
        }
      }
    } else {
      // ─── Basic schema: only email, reason, banned_at ───
      const banData: Record<string, unknown> = {
        email: userRecord.email,
        reason: reason || 'حظر بواسطة المشرف',
        banned_at: new Date().toISOString(),
      };

      const { error } = await supabaseServer
        .from('banned_users')
        .upsert(banData, { onConflict: 'email' });

      if (error) {
        console.error('Error banning user (basic schema):', error);
        // Reset schema cache in case schema changed
        _hasEnhancedSchema = null;
        return NextResponse.json(
          { success: false, error: 'حدث خطأ أثناء حظر المستخدم' },
          { status: 500 }
        );
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
