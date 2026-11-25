import { supabaseServer } from '@/lib/supabase-server';
import { pushFcmTopic } from '@/lib/fcm';

/**
 * Make an admin announcement show up as a notification for every user (bell + notifications page)
 * and as an Android system notification (one FCM topic message to all installed apps).
 * Never throws: announcement creation must not fail because of notifications.
 */
export async function notifyAnnouncement(opts: { id: string; title: string; message: string }): Promise<void> {
  try {
    const link = `announcement:${opts.id}`;
    const title = opts.title.slice(0, 200);
    const message = opts.message.replace(/\s+/g, ' ').slice(0, 300);

    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: users, error } = await supabaseServer
        .from('users')
        .select('id')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error || !users || users.length === 0) break;
      const rows = users.map((u: { id: string }) => ({ user_id: u.id, type: 'system', title, message, link }));
      const { error: insErr } = await supabaseServer.from('notifications').insert(rows);
      if (insErr) console.error('[announcement-notify] insert failed:', insErr.message);
      if (users.length < PAGE) break;
    }

    await pushFcmTopic('announcements', { title, body: message, link, type: 'system', id: opts.id });
  } catch (err) {
    console.error('[announcement-notify] failed:', err);
  }
}
