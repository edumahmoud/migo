import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/push/subscribe
 *
 * Register a push subscription for the current user.
 * Stores the subscription endpoint and keys so we can send
 * push notifications when the user is offline.
 *
 * Body: { userId: string, subscription: { endpoint, keys: { p256dh, auth } } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, subscription } = body;

    if (!userId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json(
        { error: 'بيانات الاشتراك غير مكتملة' },
        { status: 400 }
      );
    }

    // Check if this subscription already exists (by endpoint)
    const { data: existing } = await supabaseServer
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', subscription.endpoint)
      .maybeSingle();

    if (existing) {
      // Update the existing subscription (user might have re-subscribed)
      const { error } = await supabaseServer
        .from('push_subscriptions')
        .update({
          user_id: userId,
          p256dh: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) {
        console.error('Push subscription update error:', error);
        return NextResponse.json(
          { error: 'فشل في تحديث الاشتراك' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, action: 'updated' });
    }

    // Insert new subscription
    const { error } = await supabaseServer
      .from('push_subscriptions')
      .insert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
      });

    if (error) {
      console.error('Push subscription insert error:', error);
      return NextResponse.json(
        { error: 'فشل في حفظ الاشتراك' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, action: 'created' });
  } catch (error) {
    console.error('Push subscribe API error:', error);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}
