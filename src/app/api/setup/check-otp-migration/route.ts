import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/setup/check-otp-migration
 *
 * Diagnostic endpoint that reports the current state of the v73 phone-OTP
 * migration against the live Supabase database. Useful for debugging when
 * students skip the OTP page on signup.
 *
 * Strategy: probe by attempting real SELECTs against the columns/tables
 * v73 is supposed to create. We infer presence from PostgREST error
 * messages ("column ... does not exist" / "relation ... does not exist").
 *
 * No auth required (only reads catalog + sample rows) — but DOES require
 * the service role key.
 */
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server.' },
      { status: 500 }
    );
  }

  // 1. Probe the users table — does it have phone + phone_verified columns?
  const { error: probeErr } = await supabaseServer
    .from('users')
    .select('phone, phone_verified, account_status')
    .limit(1)
    .maybeSingle();

  const probeMsg = probeErr?.message || '';
  const phoneColumnExists = !/column "phone" does not exist/i.test(probeMsg);
  const phoneVerifiedColumnExists =
    !/column "phone_verified" does not exist/i.test(probeMsg);

  // 2. Probe the otp_codes table — only exists if v73 was applied.
  const { error: otpErr } = await supabaseServer
    .from('otp_codes')
    .select('id')
    .limit(1)
    .maybeSingle();
  const otpCodesTableExists =
    !otpErr || !/relation .* does not exist/i.test(otpErr?.message || '');

  // 3. Check if CHECK allows 'pending_verification' by counting rows with
  //    that status. If >0, both the CHECK and the trigger function are
  //    correct.
  let pendingVerificationCount = 0;
  if (phoneColumnExists && phoneVerifiedColumnExists) {
    const { count } = await supabaseServer
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('account_status', 'pending_verification');
    pendingVerificationCount = count ?? 0;
  }

  // 4. Sample some users with phone populated — if any exist with phone
  //    set + status pending_verification, the trigger is firing correctly.
  let samplePhoneUser: Record<string, unknown> | null = null;
  if (phoneColumnExists) {
    const { data } = await supabaseServer
      .from('users')
      .select('id, phone, phone_verified, account_status, created_at')
      .not('phone', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    samplePhoneUser = data as Record<string, unknown> | null;
  }

  // 5. Also check how many users currently have account_status='pending'
  //    AND a phone set — these are the ones stuck in the degraded state
  //    (trigger fired but didn't set pending_verification).
  let degradedPendingPhoneCount = 0;
  if (phoneColumnExists) {
    const { count } = await supabaseServer
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('account_status', 'pending')
      .not('phone', 'is', null)
      .eq('phone_verified', false);
    degradedPendingPhoneCount = count ?? 0;
  }

  const checks = {
    phone_column_exists: phoneColumnExists,
    phone_verified_column_exists: phoneVerifiedColumnExists,
    otp_codes_table_exists: otpCodesTableExists,
    pending_verification_users_count: pendingVerificationCount,
    degraded_pending_with_phone_count: degradedPendingPhoneCount,
    sample_user_with_phone: samplePhoneUser,
    probe_error: probeErr?.message ?? null,
    otp_probe_error: otpErr?.message ?? null,
  };

  // Verdict
  let verdict = 'unknown';
  const fullyApplied =
    phoneColumnExists &&
    phoneVerifiedColumnExists &&
    otpCodesTableExists &&
    (pendingVerificationCount > 0 || degradedPendingPhoneCount === 0 ? true : false);

  if (!phoneColumnExists || !phoneVerifiedColumnExists) {
    verdict = 'v73_NOT_applied — phone columns missing. Re-run v73 migration in Supabase SQL editor.';
  } else if (!otpCodesTableExists) {
    verdict = 'v73_PARTIALLY_applied — otp_codes table missing. Re-run v73.';
  } else if (pendingVerificationCount > 0) {
    verdict = 'v73_FULLY_applied — at least one user is in pending_verification state, so CHECK + trigger are both correct.';
  } else if (degradedPendingPhoneCount > 0) {
    verdict = `v73_PARTIALLY_applied — found ${degradedPendingPhoneCount} user(s) with phone set but account_status='pending' (not 'pending_verification'). The CHECK constraint widening OR the handle_new_user function update didn't take. Re-run v73.`;
  } else {
    verdict = 'v73_columns_applied_but_unverified — phone columns exist, but no users have phone populated yet. Sign up a test user with a phone number and re-check.';
  }
  if (fullyApplied && verdict === 'unknown') {
    verdict = 'v73_LIKELY_applied';
  }

  const fixSql = `-- Re-apply v73 cleanly in Supabase SQL Editor:
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('pending_verification', 'pending', 'active', 'suspended'));

-- Re-bind the trigger to the (possibly re-CREATE-OR-REPLACE-ed) function:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Optional: re-create the function body (paste from v73_phone_otp_verification.sql).
-- (Cannot inline here because of the $$ quoting in JS template strings.)
`;

  return NextResponse.json({ ...checks, verdict, fix_sql: fixSql });
}
