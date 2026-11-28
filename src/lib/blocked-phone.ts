import { supabaseServer } from '@/lib/supabase-server';
import { normalizePhoneToE164 } from '@/lib/phone-utils';

export const BLOCKED_PHONE_MESSAGE = 'لا يمكن استخدام هذا الرقم للتسجيل.';

/**
 * True when the phone belongs to a deleted (or banned) account that is still blocked.
 * Fails open on a database error, same as the email ban check, so a hiccup never locks everyone out.
 */
export async function isPhoneBlocked(phone: string | null | undefined): Promise<boolean> {
  const e164 = normalizePhoneToE164(phone);
  if (!e164) return false;
  try {
    const { data, error } = await supabaseServer
      .from('banned_users')
      .select('id, is_active, ban_until')
      .eq('phone', e164)
      .limit(5);
    if (error || !data) return false;
    const now = new Date();
    return data.some((r: { is_active: boolean | null; ban_until: string | null }) =>
      (r.is_active === null || r.is_active === true) && (!r.ban_until || new Date(r.ban_until) > now));
  } catch {
    return false;
  }
}
