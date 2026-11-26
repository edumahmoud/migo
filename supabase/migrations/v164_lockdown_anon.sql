-- v164: close anonymous access holes found in the pentest (phase 1)
-- Server routes use the service role (bypasses RLS), so they are not affected.

-- 1. Google OAuth tokens: nobody but the service role.
DROP POLICY IF EXISTS "Service role has full access to Google OAuth tokens" ON public.google_oauth_tokens;
ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_oauth_tokens FROM anon, authenticated;

-- 2. Announcements: admin-only writes (was ALL for everyone).
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Admins can manage announcements" ON public.announcements
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3. Institution settings: admin-only writes (was open to everyone).
DROP POLICY IF EXISTS "Service can insert institution_settings" ON public.institution_settings;
DROP POLICY IF EXISTS "Service can update institution_settings" ON public.institution_settings;
CREATE POLICY "Admins can modify institution_settings" ON public.institution_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. Chat: only the server (service role) creates conversations and participants.
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can add participants" ON public.conversation_participants;

-- 5. Reads that said "anyone" now require a login.
ALTER POLICY "Anyone authenticated can find teachers" ON public.users TO authenticated;
ALTER POLICY "Anyone can select views" ON public.video_views TO authenticated;
ALTER POLICY "Users can view note views" ON public.note_views TO authenticated;
ALTER POLICY "Anyone can read announcement views" ON public.platform_announcement_views TO authenticated;
ALTER POLICY "Authenticated can read discussions" ON public.lesson_discussions TO authenticated;

-- 6. Anonymous role: no writes anywhere, no reads of private tables.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
REVOKE SELECT ON public.users, public.user_files, public.otp_codes, public.device_tokens, public.admin_security,
  public.payments, public.orders, public.conversations, public.conversation_participants, public.messages,
  public.notifications, public.push_subscriptions, public.video_views, public.note_views,
  public.platform_announcement_views, public.lesson_discussions FROM anon;
