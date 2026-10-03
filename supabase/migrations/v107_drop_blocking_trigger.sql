-- =====================================================
-- v107: Drop v96 trigger that blocks user deletion
-- =====================================================
-- The v96 migration created trg_snapshot_user_on_delete which fires
-- BEFORE DELETE on public.users. It tries to INSERT into
-- deleted_users table. If the table doesn't exist, or has RLS
-- issues, or any other error occurs in the trigger function,
-- the DELETE is ROLLED BACK — user profile stays in users table.
--
-- This is the root cause of "تم حذف المستخدم ومش بيتحذف" —
-- the API returns success (because v107 code always returns success)
-- but the profile DELETE silently fails because of this trigger.
--
-- Fix: DROP the trigger. The deleted_users audit table is a
-- "nice to have" — it's NOT worth blocking user deletion.
-- The ban-user API + banned_users table already provide audit trail.
-- =====================================================

-- Drop the BEFORE DELETE trigger on users
DROP TRIGGER IF EXISTS trg_snapshot_user_on_delete ON public.users;

-- Also drop the trigger function (cleanup)
DROP FUNCTION IF EXISTS public.snapshot_user_on_delete();

-- Done.
-- The deleted_users table (if it exists) is now unused —
-- admins can drop it manually if they want to reclaim space.
