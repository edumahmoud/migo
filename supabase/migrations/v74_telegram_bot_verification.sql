-- =============================================================
-- v74_telegram_bot_verification.sql
-- AttenDo LMS — Switch OTP delivery from Telegram Gateway (paid TON)
-- to Telegram Bot API (free). The Gateway was returning
-- BALANCE_NOT_ENOUGH because the account's TON wallet was empty.
--
-- New flow:
--   1. User lands on OTP page → POST /api/auth/initiate-telegram-verification
--      → inserts a row with verify_token_hash + status='pending_start'
--   2. User clicks "Open Telegram" → deep link to t.me/BOT_USERNAME?start=VERIFY_TOKEN
--   3. User clicks Start in Telegram → Telegram sends /start VERIFY_TOKEN
--      to webhook → webhook verifies token, generates OTP, sends via Bot API
--      → updates status='otp_sent'
--   4. User enters OTP in website → POST /api/auth/verify-otp
--      → verifies hash → updates status='verified' + phone_verified=true
--
-- This migration extends the existing otp_codes table (no new table):
--   - Adds verify_token_hash + verify_token_salt + verify_expires_at
--   - Adds status enum (otp_only/pending_start/otp_sent/verified/expired)
--   - Drops NOT NULL from code_hash/code_salt/expires_at (now nullable
--     because in the new flow they're set later by the webhook)
--   - Adds indexes for fast lookup by verify_token_hash + status
-- =============================================================

-- 1. Drop NOT NULL from OTP fields (nullable in new flow until webhook fills them)
ALTER TABLE public.otp_codes ALTER COLUMN code_hash DROP NOT NULL;
ALTER TABLE public.otp_codes ALTER COLUMN code_salt DROP NOT NULL;
ALTER TABLE public.otp_codes ALTER COLUMN expires_at DROP NOT NULL;

-- 2. Add verification session fields
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS verify_token_hash TEXT;
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS verify_token_salt TEXT;
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS verify_expires_at TIMESTAMPTZ;
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'otp_only'
    CHECK (status IN ('otp_only', 'pending_start', 'otp_sent', 'verified', 'expired'));
ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_otp_codes_verify_token ON public.otp_codes(verify_token_hash);
CREATE INDEX IF NOT EXISTS idx_otp_codes_status ON public.otp_codes(status);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_status ON public.otp_codes(user_id, status);

-- 4. Update the existing RLS policies to allow the webhook (service role)
--    to UPDATE rows by verify_token_hash. Service role bypasses RLS by
--    default, so no additional policy is needed. The existing
--    otp_student_read + otp_admin_all policies still apply for client-side
--    queries (the OTP page reads via the user's auth).

-- 5. Update handle_new_user() trigger to be Bot-API-friendly:
--    We don't need to call the Gateway anymore. The trigger stays the same
--    (it sets account_status='pending_verification' for self-registered
--    students with a phone). The phone is no longer used for OTP delivery
--    but is still stored for display + the user's records.

-- 6. Backfill: any existing 'otp_only' rows (created by the old Gateway
--    flow) should be marked 'expired' so they don't interfere with the
--    new flow's status lookups.
UPDATE public.otp_codes
SET status = 'expired'
WHERE status = 'otp_only' AND used = false;
