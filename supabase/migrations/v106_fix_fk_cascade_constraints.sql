-- =====================================================
-- v106: Fix FK constraints blocking user + subject deletion
-- =====================================================
-- ROOT CAUSE of "حدث خطأ أثناء حذف المستخدم/المقرر":
-- 6 FK constraints use ON DELETE NO ACTION (= RESTRICT) instead
-- of ON DELETE SET NULL. When admin tries to delete a user/subject
-- that has related rows (announcements, quizzes, teams), PostgreSQL
-- blocks the delete with FK violation → API returns error → toast.
--
-- This migration changes all 6 FKs to ON DELETE SET NULL.
-- The columns are all nullable, so SET NULL is safe — it disconnects
-- the row from the deleted user/subject without deleting the data.
--
-- Idempotent — uses DROP CONSTRAINT IF EXISTS before ADD.
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. quizzes.subject_id → SET NULL (blocks subject deletion)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_subject_id_fkey;
ALTER TABLE public.quizzes
  ADD CONSTRAINT quizzes_subject_id_fkey
  FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────
-- 2. quizzes.user_id → SET NULL (blocks user deletion)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.quizzes DROP CONSTRAINT IF EXISTS quizzes_user_id_fkey;
ALTER TABLE public.quizzes
  ADD CONSTRAINT quizzes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────
-- 3. announcements.created_by → SET NULL (blocks user deletion)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_created_by_fkey;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────
-- 4. platform_announcements.created_by → SET NULL (blocks user deletion)
-- ─────────────────────────────────────────────────────
ALTER TABLE public.platform_announcements DROP CONSTRAINT IF EXISTS platform_announcements_created_by_fkey;
ALTER TABLE public.platform_announcements
  ADD CONSTRAINT platform_announcements_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────
-- 5. platform_announcement_views.user_id → SET NULL (blocks user deletion)
--    NOTE: user_id is on platform_announcement_views, NOT platform_announcements
-- ─────────────────────────────────────────────────────
ALTER TABLE public.platform_announcement_views DROP CONSTRAINT IF EXISTS platform_announcement_views_user_id_fkey;
ALTER TABLE public.platform_announcement_views
  ADD CONSTRAINT platform_announcement_views_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────
-- 6. subject_teams.created_by → SET NULL (blocks user deletion)
--    NOTE: table is subject_teams, NOT teams
-- ─────────────────────────────────────────────────────
ALTER TABLE public.subject_teams DROP CONSTRAINT IF EXISTS subject_teams_created_by_fkey;
ALTER TABLE public.subject_teams
  ADD CONSTRAINT subject_teams_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- Done.
-- Verify:
--   SELECT conname, confdeltype FROM pg_constraint
--   WHERE conname IN (
--     'quizzes_subject_id_fkey', 'quizzes_user_id_fkey',
--     'announcements_created_by_fkey',
--     'platform_announcements_created_by_fkey',
--     'platform_announcements_user_id_fkey',
--     'teams_created_by_fkey'
--   );
-- confdeltype should be 'a' (= SET NULL) for all 6.
