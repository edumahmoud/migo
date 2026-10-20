-- =============================================================
-- v134c_cleanup_orphaned_auth_users.sql
-- AttenDo LMS — Clean up orphaned auth.users after data-destruct
--
-- Background:
--   The v133 data-destruct feature deletes rows from public.users
--   but does NOT delete the corresponding auth.users entries. This
--   leaves "orphaned" auth accounts. When a user tries to sign up
--   with an email that has an orphaned auth account:
--     - Supabase finds the existing auth user (email already confirmed)
--     - Returns a session immediately (no confirmation email sent)
--     - handle_new_user() trigger does NOT fire (no INSERT on auth.users)
--     - public.users doesn't get a new row → user is stuck
--
--   This migration:
--   1. Deletes orphaned auth.users entries (auth users with no
--      matching public.users row)
--   2. Keeps the admin's auth account intact
--
--   After running this, users can sign up with their emails again
--   and will receive fresh confirmation emails.
-- =============================================================

-- Delete orphaned auth.users entries.
-- An auth user is "orphaned" if it has no matching row in public.users.
-- We use a PL/pgSQL block because we need to call auth.admin functions.
DO $$
DECLARE
  orphaned RECORD;
  deleted_count INTEGER := 0;
BEGIN
  FOR orphaned IN
    SELECT au.id, au.email
    FROM auth.users au
    LEFT JOIN public.users pu ON pu.id = au.id
    WHERE pu.id IS NULL
  LOOP
    BEGIN
      -- Delete the orphaned auth user.
      -- We use DELETE directly on auth.users (service role has access).
      DELETE FROM auth.users WHERE id = orphaned.id;
      deleted_count := deleted_count + 1;
      RAISE NOTICE 'Deleted orphaned auth user: % (%)', orphaned.email, orphaned.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to delete orphaned auth user % (%): %', orphaned.email, orphaned.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Cleanup complete. Deleted % orphaned auth users.', deleted_count;
END;
$$;

-- Also clean up any orphaned identities (auth.identities table)
-- that might reference deleted auth users.
DELETE FROM auth.identities
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Clean up auth.sessions for deleted users
DELETE FROM auth.sessions
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Clean up auth.mfa_factors for deleted users
DELETE FROM auth.mfa_factors
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- Clean up auth.refresh_tokens for deleted users
DELETE FROM auth.refresh_tokens
WHERE user_id NOT IN (SELECT id FROM auth.users);

COMMENT ON THIS MIGRATION IS
  'v134c: Cleans up orphaned auth.users entries left by the v133 data-destruct feature. Restores the ability for users to sign up and receive confirmation emails.';
