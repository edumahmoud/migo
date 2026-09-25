-- =============================================================
-- backfill_phones_to_e164.sql
-- =============================================================
-- AttenDo LMS — Backfill existing users' phone numbers to E.164
-- international format (required by Telegram Gateway).
--
-- Run this ONCE in the Supabase SQL Editor after deploying the
-- phone-utils normalization fix. It converts:
--   - Local Egyptian format (starts with 0) → +20XXXXXXXXXX
--   - International without + (starts with 20, 966, 1, etc.) → +...
--   - Numbers starting with 00 → +...
--
-- Idempotent — safe to run multiple times.
-- =============================================================

-- 1. Egyptian local numbers (start with 0, no + prefix):
--    Strip the leading 0, prepend +20.
UPDATE public.users
SET phone = '+20' || SUBSTRING(phone FROM 2),
    updated_at = now()
WHERE phone IS NOT NULL
  AND phone NOT LIKE '+%'
  AND phone LIKE '0%';

-- 2. International numbers with 00 prefix → +
UPDATE public.users
SET phone = '+' || SUBSTRING(phone FROM 3),
    updated_at = now()
WHERE phone IS NOT NULL
  AND phone NOT LIKE '+%'
  AND phone LIKE '00%';

-- 3. International numbers without + or 00 (assume missing +):
--    Prepend +.
UPDATE public.users
SET phone = '+' || phone,
    updated_at = now()
WHERE phone IS NOT NULL
  AND phone NOT LIKE '+%'
  AND phone NOT LIKE '0%';

-- 4. Show the result for verification:
-- SELECT id, phone, phone_verified, account_status
-- FROM public.users
-- WHERE phone IS NOT NULL
-- ORDER BY created_at DESC
-- LIMIT 20;
