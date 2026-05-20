-- =====================================================
-- v39: Report system RLS fixes + action constraint fix
-- 1. Allow the TARGET USER (reported person) to see reports against them
-- 2. Allow the TARGET USER to see report responses for reports against them
-- 3. Add 'return' action to report_responses CHECK constraint
-- =====================================================

-- 1. Update reports SELECT policy to include the target user
-- Previously: only reporter_id, assigned_to, and admins could see reports
-- Now: target user (where target_type='user' AND target_id=auth.uid()) can also see reports against them
DROP POLICY IF EXISTS "Users can view relevant reports" ON public.reports;
CREATE POLICY "Users can view relevant reports" ON public.reports
  FOR SELECT USING (
    auth.uid() = reporter_id
    OR auth.uid() = assigned_to
    OR (target_type = 'user' AND target_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  );

-- 2. Update report_responses SELECT policy to include the target user
-- Target users need to see actions taken on reports against them (e.g., warn, block)
DROP POLICY IF EXISTS "Users can view report responses" ON public.report_responses;
CREATE POLICY "Users can view report responses" ON public.report_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.reporter_id = auth.uid()
        OR r.assigned_to = auth.uid()
        OR (r.target_type = 'user' AND r.target_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );

-- 3. Add 'return' action to the report_responses CHECK constraint
-- The PATCH handler creates responses with action='return' but the CHECK constraint didn't include it
ALTER TABLE public.report_responses DROP CONSTRAINT IF EXISTS report_responses_action_check;
ALTER TABLE public.report_responses ADD CONSTRAINT report_responses_action_check
  CHECK (action IN ('reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'return', 'message_reporter', 'message_reported'));

-- 4. Also update the reports UPDATE policy to allow the target user to update
-- (e.g., reopen a report against them) — actually, only the reporter should reopen
-- But target users need to be able to see the report in the first place (handled by SELECT policy above)
