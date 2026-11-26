-- v165: relationship-based profile visibility + chat policy recursion fix
CREATE OR REPLACE FUNCTION public.my_conversation_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.my_conversation_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_conversation_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_user(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    target = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','superadmin'))
    OR EXISTS (SELECT 1 FROM public.teacher_student_links l WHERE (l.teacher_id = auth.uid() AND l.student_id = target) OR (l.student_id = auth.uid() AND l.teacher_id = target))
    OR EXISTS (SELECT 1 FROM public.subject_students ss JOIN public.subjects s ON s.id = ss.subject_id WHERE (ss.student_id = target AND (s.teacher_id = auth.uid() OR EXISTS (SELECT 1 FROM public.subject_teachers st WHERE st.subject_id = s.id AND st.teacher_id = auth.uid()))) OR (ss.student_id = auth.uid() AND (s.teacher_id = target OR EXISTS (SELECT 1 FROM public.subject_teachers st WHERE st.subject_id = s.id AND st.teacher_id = target))))
    OR EXISTS (SELECT 1 FROM public.subject_students a JOIN public.subject_students b ON a.subject_id = b.subject_id WHERE a.student_id = auth.uid() AND b.student_id = target)
    OR EXISTS (SELECT 1 FROM public.subject_teachers a JOIN public.subject_teachers b ON a.subject_id = b.subject_id WHERE a.teacher_id = auth.uid() AND b.teacher_id = target)
    OR EXISTS (SELECT 1 FROM public.subject_teachers st JOIN public.subjects s ON s.id = st.subject_id JOIN public.subject_students ss ON ss.subject_id = s.id WHERE st.teacher_id = auth.uid() AND ss.student_id = target)
    OR EXISTS (SELECT 1 FROM public.conversation_participants a JOIN public.conversation_participants b ON a.conversation_id = b.conversation_id WHERE a.user_id = auth.uid() AND b.user_id = target)
    OR EXISTS (SELECT 1 FROM public.team_members a JOIN public.team_members b ON a.team_id = b.team_id WHERE a.student_id = auth.uid() AND b.student_id = target)
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_user(uuid) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.users;
CREATE POLICY "Users can read related profiles" ON public.users FOR SELECT TO authenticated USING (public.can_view_user(id));

DROP POLICY IF EXISTS "Users can view their own participants" ON public.conversation_participants;
CREATE POLICY "Users can view their own participants" ON public.conversation_participants FOR SELECT USING (conversation_id IN (SELECT public.my_conversation_ids()));
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations" ON public.conversations FOR SELECT USING (id IN (SELECT public.my_conversation_ids()));
DROP POLICY IF EXISTS "Users can update their conversations" ON public.conversations;
CREATE POLICY "Users can update their conversations" ON public.conversations FOR UPDATE USING (id IN (SELECT public.my_conversation_ids()));
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations" ON public.messages FOR SELECT USING (conversation_id IN (SELECT public.my_conversation_ids()));
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages FOR INSERT WITH CHECK (sender_id = auth.uid() AND conversation_id IN (SELECT public.my_conversation_ids()));
