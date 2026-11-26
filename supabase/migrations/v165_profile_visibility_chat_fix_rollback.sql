DROP POLICY IF EXISTS "Users can read related profiles" ON public.users;
CREATE POLICY "Authenticated users can read profiles" ON public.users FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Users can view their own participants" ON public.conversation_participants;
CREATE POLICY "Users can view their own participants" ON public.conversation_participants FOR SELECT USING (conversation_id IN (SELECT cp.conversation_id FROM conversation_participants cp WHERE cp.user_id = auth.uid()));
