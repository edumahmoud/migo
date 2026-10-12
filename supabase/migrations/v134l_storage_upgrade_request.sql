-- =============================================================
-- v134l_storage_upgrade_request.sql
-- AttenDo LMS — Storage upgrade requests
--
-- Bug:
--   When a user clicked "اشتراك" on a storage plan, the request
--   hit /api/sections/activation-request which required the
--   'files' section to be LOCKED. Since files is unlocked by
--   default (free quota is always active), the request failed
--   with "هذا القسم غير مقفل".
--
-- Fix:
--   - Add `request_type` column to section_activation_requests
--     ('section_unlock' | 'storage_upgrade'). Default 'section_unlock'
--     for backward compat with existing rows.
--   - Add `plan_id` column (nullable) to link storage upgrade
--     requests to the storage_plans row the user picked.
--   - The activation-request API skips the lock check when
--     request_type = 'storage_upgrade'.
--
-- No data migration needed — existing NULLs default to 'section_unlock'
-- at the API layer (treated as section_unlock).
-- =============================================================

-- 1. Add request_type column (default 'section_unlock' for new rows).
ALTER TABLE public.section_activation_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT
  DEFAULT 'section_unlock';

-- Add a CHECK constraint for valid values.
DO $$
BEGIN
  -- Drop existing constraint if it exists (idempotent).
  ALTER TABLE public.section_activation_requests
    DROP CONSTRAINT IF EXISTS chk_request_type;
  ALTER TABLE public.section_activation_requests
    ADD CONSTRAINT chk_request_type CHECK (
      request_type IS NULL
      OR request_type IN ('section_unlock', 'storage_upgrade')
    );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Add plan_id column (nullable, FK to storage_plans).
ALTER TABLE public.section_activation_requests
  ADD COLUMN IF NOT EXISTS plan_id UUID
  REFERENCES public.storage_plans(id) ON DELETE SET NULL;

-- 3. Backfill existing rows as 'section_unlock' (they were all section
--    unlock requests before this migration).
UPDATE public.section_activation_requests
SET request_type = 'section_unlock'
WHERE request_type IS NULL;

-- 4. Index for filtering storage upgrade requests in the admin UI.
CREATE INDEX IF NOT EXISTS idx_section_activation_requests_type
  ON public.section_activation_requests(request_type)
  WHERE request_type = 'storage_upgrade';

-- 5. Verify.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'section_activation_requests'
  AND column_name IN ('request_type', 'plan_id')
ORDER BY column_name;
