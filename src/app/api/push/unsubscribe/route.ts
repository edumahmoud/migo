import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/push/unsubscribe
 *
 * Remove a push subscription when the user disables notifications
 * or the subscription becomes invalid.
 *
 * Body: { endpoint: string } or { userId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, userId } = body;

    if (!endpoint && !userId) {
      return NextResponse.json(
        { error: 'يجب تحديد endpoint أو userId' },
        { status: 400 }
      );
    }

    if (endpoint) {
      // Remove specific subscription by endpoint
      const { error } = await supabaseServer
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);

      if (error) {
        console.error('Push unsubscribe error:', error);
        return NextResponse.json(
          { error: 'فشل في إلغاء الاشتراك' },
          { status: 500 }
        );
      }
    } else {
      // Remove all subscriptions for this user
      const { error } = await supabaseServer
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('Push unsubscribe error:', error);
        return NextResponse.json(
          { error: 'فشل في إلغاء الاشتراك' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push unsubscribe API error:', error);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
