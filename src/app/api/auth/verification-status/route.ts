import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/auth/verification-status
 *
 * Returns the current state of the user's latest verification session.
 * Used by the OTP page for polling (without page reload).
 *
 * Returns:
 *   status: 'no_session' | 'pending_start' | 'otp_sent' | 'verified' | 'expired'
 *   phone: string (current stored phone, for display)
 *
 * The frontend uses this to know when to:
 *   - Show the OTP input (status='otp_sent')
 *   - Show "expired, retry" (status='expired')
 *   - Redirect to activation (status='verified')
 *   - Keep waiting (status='pending_start')
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Fetch user profile (for phone_verified flag)
  const { data: profile } = await supabaseServer
    .from('users')
    .select('id, phone, phone_verified, account_status')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ status: 'no_profile' });
  }

  const p = profile as {
    id: string;
    phone: string | null;
    phone_verified: boolean;
    account_status: string;
  };

  // 2. If phone is already verified, return 'verified' (no DB lookup needed)
  if (p.phone_verified) {
    return NextResponse.json({ status: 'verified', phone: p.phone });
  }

  // 3. Fetch the latest verification session row
  const { data: session } = await supabaseServer
    .from('otp_codes')
    .select('id, status, verify_expires_at, expires_at, phone')
    .eq('user_id', p.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ status: 'no_session', phone: p.phone });
  }

  const s = session as {
    id: string;
    status: string;
    verify_expires_at: string | null;
    expires_at: string | null;
    phone: string;
  };

  const now = new Date();

  // 4. Check expiry based on current status
  //    - pending_start → check verify_expires_at
  //    - otp_sent     → check expires_at
  if (s.status === 'pending_start' && s.verify_expires_at) {
    if (new Date(s.verify_expires_at) <= now) {
      // Auto-expire in DB to prevent future matches
      await supabaseServer
        .from('otp_codes')
        .update({ status: 'expired', updated_at: now.toISOString() })
        .eq('id', s.id);
      return NextResponse.json({ status: 'expired', phone: s.phone });
    }
    return NextResponse.json({ status: 'pending_start', phone: s.phone });
  }

  if (s.status === 'otp_sent' && s.expires_at) {
    if (new Date(s.expires_at) <= now) {
      await supabaseServer
        .from('otp_codes')
        .update({ status: 'expired', updated_at: now.toISOString() })
        .eq('id', s.id);
      return NextResponse.json({ status: 'expired', phone: s.phone });
    }
    return NextResponse.json({ status: 'otp_sent', phone: s.phone });
  }

  // status is 'verified', 'expired', or 'otp_only'
  return NextResponse.json({ status: s.status, phone: s.phone });
}
