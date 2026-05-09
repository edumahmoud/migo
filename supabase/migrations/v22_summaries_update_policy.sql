-- =====================================================
-- Migration v22: Add UPDATE policy to summaries table
-- =====================================================
-- Previously, summaries only had SELECT, INSERT, DELETE policies.
-- Users could not update their own summaries (e.g., edit title/content).
-- This adds the missing UPDATE RLS policy.
-- =====================================================

-- Users can update their own summaries
CREATE POLICY "Users can update own summaries" ON public.summaries
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
