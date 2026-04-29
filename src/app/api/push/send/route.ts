import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { sendPushNotification, type PushSubscriptionLike } from '@/lib/web-push';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/push/send
 *
 * General-purpose push notification sending endpoint.
 * Accepts { userId, title, message, url?, type? } and sends
 * web push notifications to all of the user's push subscriptions.
 *
 * Also cleans up expired subscriptions (410 Gone / 404 Not Found).
 */
export async function POST(request: NextRequest) {
  try {
    // Only admins can trigger push notifications programmatically
    const authResult = await requireAdmin(request);
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }

    const body = await request.json();
    const { userId, title, message, url, type } = body;

    if (!userId || !title || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, title, message' },
        { status: 400 }
      );
    }

    // Fetch push subscriptions for this user
    const { data: subs, error } = await supabaseServer
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('user_id', userId);

    if (error) {
      console.error('[push/send] Failed to fetch subscriptions:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch push subscriptions' },
        { status: 500 }
      );
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({
        success: true,
        sent: 0,
        message: 'No push subscriptions found for this user',
      });
    }

    const payload = {
      title,
      message,
      url: url || '/',
      type: type || 'system',
    };

    const expiredEndpoints: string[] = [];
    let sent = 0;
    let skipped = 0;

    for (const sub of subs) {
      const subscription: PushSubscriptionLike = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      };

      const result = await sendPushNotification(subscription, payload);
      if (result.success) {
        sent++;
      } else if (result.expired) {
        // Only delete if the subscription is actually expired (410/404)
        expiredEndpoints.push(sub.endpoint);
      } else {
        // VAPID not configured or other error — don't delete the subscription
        skipped++;
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await supabaseServer
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      }
      console.log(
        `[push/send] Cleaned up ${expiredEndpoints.length} expired subscription(s) for user ${userId}`
      );
    }

    return NextResponse.json({
      success: true,
      sent,
      expired: expiredEndpoints.length,
      skipped,
    });
  } catch (error) {
    console.error('[push/send] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
