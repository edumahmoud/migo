-- rollback for v164 (restores the previous, insecure state)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_tokens TO anon, authenticated;
CREATE POLICY "Service role has full access to Google OAuth tokens" ON public.google_oauth_tokens FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Admins can manage announcements" ON public.announcements FOR ALL TO public USING (true);
DROP POLICY IF EXISTS "Admins can modify institution_settings" ON public.institution_settings;
CREATE POLICY "Service can insert institution_settings" ON public.institution_settings FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Service can update institution_settings" ON public.institution_settings FOR UPDATE TO public USING (true);
CREATE POLICY "Users can create conversations" ON public.conversations FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Users can add participants" ON public.conversation_participants FOR INSERT TO public WITH CHECK (true);
ALTER POLICY "Anyone authenticated can find teachers" ON public.users TO public;
ALTER POLICY "Anyone can select views" ON public.video_views TO public;
ALTER POLICY "Users can view note views" ON public.note_views TO public;
ALTER POLICY "Anyone can read announcement views" ON public.platform_announcement_views TO public;
ALTER POLICY "Authenticated can read discussions" ON public.lesson_discussions TO public;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT ON public.users, public.user_files, public.otp_codes, public.device_tokens, public.admin_security,
  public.payments, public.orders, public.conversations, public.conversation_participants, public.messages,
  public.notifications, public.push_subscriptions, public.video_views, public.note_views,
  public.platform_announcement_views, public.lesson_discussions TO anon;
