import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  // 🔒 SECURITY: Require authentication — ban status should not be publicly queryable
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');
    const userId = searchParams.get('userId');

    if (!email && !userId) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني أو معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // Try querying with new schema (has is_active column)
    let query = supabaseServer
      .from('banned_users')
      .select('*');

    if (email) {
      query = query.eq('email', email);
    } else if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: banRecords, error } = await query;

    if (error) {
      console.error('Error checking ban status:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء التحقق من حالة الحظر' },
        { status: 500 }
      );
    }

    if (!banRecords || banRecords.length === 0) {
      return NextResponse.json({ success: true, isBanned: false });
    }

    // Filter for active bans (handle both old and new schema)
    const now = new Date();
    const activeBans = banRecords.filter((ban: Record<string, unknown>) => {
      // Old schema: no is_active column, treat all as active
      // New schema: check is_active
      const isActive = ban.is_active === undefined || ban.is_active === true;
      if (!isActive) return false;

      // Check if ban has expired
      if (!ban.ban_until) return true; // Permanent ban
      return new Date(ban.ban_until as string) > now;
    });

    if (activeBans.length > 0) {
      const activeBan = activeBans[0] as Record<string, unknown>;

      // Auto-deactivate expired bans (new schema only)
      for (const ban of banRecords) {
        const banRecord = ban as Record<string, unknown>;
        if (banRecord.is_active !== undefined && banRecord.ban_until && new Date(banRecord.ban_until as string) <= now) {
          await supabaseServer
            .from('banned_users')
            .update({ is_active: false })
            .eq('id', banRecord.id);
        }
      }

      return NextResponse.json({
        success: true,
        isBanned: true,
        ban: {
          id: activeBan.id,
          reason: activeBan.reason || null,
          bannedAt: activeBan.banned_at,
          banUntil: activeBan.ban_until || null,
          isPermanent: !activeBan.ban_until,
        },
      });
    }

    // All bans are expired or inactive
    // Auto-deactivate expired bans (new schema only)
    for (const ban of banRecords) {
      const banRecord = ban as Record<string, unknown>;
      if (banRecord.is_active !== undefined && banRecord.ban_until && new Date(banRecord.ban_until as string) <= now) {
        await supabaseServer
          .from('banned_users')
          .update({ is_active: false })
          .eq('id', banRecord.id);
      }
    }

    return NextResponse.json({ success: true, isBanned: false });
  } catch (error) {
    console.error('Check ban status error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
