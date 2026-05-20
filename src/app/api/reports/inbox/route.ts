// =====================================================
// Reports Inbox API — Fetch messages for current user
// Uses server-side Supabase (service role) to bypass RLS
// so the recipient can always see their messages.
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// GET /api/reports/inbox — Get all report messages where current user is recipient
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;

    // First check if report_messages table exists by attempting a count
    const { count, error: countError } = await supabaseServer
      .from('report_messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId);

    if (countError) {
      console.error('[Reports Inbox] Table check error:', countError.message);
      // Table might not exist — return empty instead of failing
      return NextResponse.json({
        success: true,
        data: [],
        warning: 'report_messages table may not exist yet. Please run v38 migration.',
      });
    }

    const { data, error } = await supabaseServer
      .from('report_messages')
      .select(`
        *,
        sender:users!report_messages_sender_id_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Reports Inbox] Fetch error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب الرسائل الواردة' },
        { status: 500 }
      );
    }

    console.log('[Reports Inbox] Found', (data || []).length, 'messages for user', userId);

    return NextResponse.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('[Reports Inbox] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
