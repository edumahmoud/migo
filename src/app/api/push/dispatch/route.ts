import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { pushFcmToUser } from '@/lib/fcm';
import { pushToUsers } from '@/lib/notifications-service';

/**
 * POST /api/push/dispatch  { id }  — called by a Postgres trigger (pg_net) for every new
 * notifications row. Authenticated with a shared secret header. The body is only an id: the
 * title/message/link are read from the database, so a caller cannot push arbitrary text.
 */
export const maxDuration = 30;

function secretOk(given: string | null): boolean {
  const expected = process.env.PUSH_DISPATCH_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!secretOk(request.headers.get('x-push-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== 'string') return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const { data: n } = await supabaseServer
    .from('notifications')
    .select('id, user_id, type, title, message, link')
    .eq('id', id)
    .maybeSingle();
  if (!n) return NextResponse.json({ success: true, skipped: 'not found' });

  try {
    const r = await pushFcmToUser(n.user_id, { title: n.title, body: n.message, link: n.link || '', type: n.type, id: n.id });
    // Browser (web push) devices of the same user, so desktop/PWA gets the same notification.
    await pushToUsers([n.user_id], n.title, n.message, n.link || undefined, n.type).catch(() => {});
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    console.error('[push/dispatch]', e);
    return NextResponse.json({ error: 'push failed' }, { status: 502 });
  }
}
