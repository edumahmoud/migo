-- =====================================================
-- v50: Todo List, Polls/Surveys, and Calendar tables
-- Adds: user_todos, polls, poll_options, poll_responses
-- =====================================================

-- =====================================================
-- 1. USER_TODOS — Personal task management for students/teachers
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'medium', 'low')),
  category TEXT NOT NULL DEFAULT 'personal' CHECK (category IN ('study', 'assignment', 'review', 'personal')),
  due_date TIMESTAMPTZ,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for user_todos
CREATE INDEX IF NOT EXISTS idx_user_todos_user_id ON public.user_todos(user_id);
CREATE INDEX IF NOT EXISTS idx_user_todos_due_date ON public.user_todos(due_date);
CREATE INDEX IF NOT EXISTS idx_user_todos_subject_id ON public.user_todos(subject_id);
CREATE INDEX IF NOT EXISTS idx_user_todos_completed ON public.user_todos(user_id, completed);

-- Enable RLS
ALTER TABLE public.user_todos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_todos: users can only CRUD their own todos
DROP POLICY IF EXISTS "Users can read own todos" ON public.user_todos;
CREATE POLICY "Users can read own todos" ON public.user_todos
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own todos" ON public.user_todos;
CREATE POLICY "Users can create own todos" ON public.user_todos
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own todos" ON public.user_todos;
CREATE POLICY "Users can update own todos" ON public.user_todos
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own todos" ON public.user_todos;
CREATE POLICY "Users can delete own todos" ON public.user_todos
  FOR DELETE USING (user_id = auth.uid());

-- Trigger: auto-update updated_at
DROP TRIGGER IF EXISTS trg_user_todos_updated_at ON public.user_todos;
CREATE TRIGGER trg_user_todos_updated_at
  BEFORE UPDATE ON public.user_todos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =====================================================
-- 2. POLLS — Voting, rating, and open-ended polls within subjects
-- =====================================================

CREATE TABLE IF NOT EXISTS public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'vote' CHECK (type IN ('vote', 'rating', 'open')),
  is_anonymous BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for polls
CREATE INDEX IF NOT EXISTS idx_polls_subject_id ON public.polls(subject_id);
CREATE INDEX IF NOT EXISTS idx_polls_created_by ON public.polls(created_by);
CREATE INDEX IF NOT EXISTS idx_polls_status ON public.polls(status);
CREATE INDEX IF NOT EXISTS idx_polls_closes_at ON public.polls(closes_at) WHERE closes_at IS NOT NULL;

-- Enable RLS
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

-- RLS Policies for polls:
-- Anyone in the subject can SELECT (teachers, co-teachers, enrolled students)
DROP POLICY IF EXISTS "Subject members can view polls" ON public.polls;
CREATE POLICY "Subject members can view polls" ON public.polls
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    OR subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );

-- Only teachers/co-teachers of the subject can INSERT
DROP POLICY IF EXISTS "Teachers can create polls" ON public.polls;
CREATE POLICY "Teachers can create polls" ON public.polls
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- Only the creator can UPDATE their own polls
DROP POLICY IF EXISTS "Creators can update own polls" ON public.polls;
CREATE POLICY "Creators can update own polls" ON public.polls
  FOR UPDATE USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Only the creator can DELETE their own polls
DROP POLICY IF EXISTS "Creators can delete own polls" ON public.polls;
CREATE POLICY "Creators can delete own polls" ON public.polls
  FOR DELETE USING (created_by = auth.uid());

-- Trigger: auto-update updated_at
DROP TRIGGER IF EXISTS trg_polls_updated_at ON public.polls;
CREATE TRIGGER trg_polls_updated_at
  BEFORE UPDATE ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- =====================================================
-- 3. POLL_OPTIONS — Options for vote-type polls
-- =====================================================

CREATE TABLE IF NOT EXISTS public.poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Indexes for poll_options
CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON public.poll_options(poll_id);

-- Enable RLS
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;

-- RLS Policies for poll_options:
-- Anyone in the subject can SELECT (via the poll's subject membership)
DROP POLICY IF EXISTS "Subject members can view poll options" ON public.poll_options;
CREATE POLICY "Subject members can view poll options" ON public.poll_options
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
      )
    )
  );

-- Only the poll creator can INSERT options
DROP POLICY IF EXISTS "Poll creators can insert options" ON public.poll_options;
CREATE POLICY "Poll creators can insert options" ON public.poll_options
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id AND p.created_by = auth.uid()
    )
  );

-- Only the poll creator can UPDATE options
DROP POLICY IF EXISTS "Poll creators can update options" ON public.poll_options;
CREATE POLICY "Poll creators can update options" ON public.poll_options
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id AND p.created_by = auth.uid()
    )
  );

-- Only the poll creator can DELETE options
DROP POLICY IF EXISTS "Poll creators can delete options" ON public.poll_options;
CREATE POLICY "Poll creators can delete options" ON public.poll_options
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id AND p.created_by = auth.uid()
    )
  );


-- =====================================================
-- 4. POLL_RESPONSES — Responses/submissions for polls
-- =====================================================

CREATE TABLE IF NOT EXISTS public.poll_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_id UUID REFERENCES public.poll_options(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response_text TEXT,
  rating_value INTEGER CHECK (rating_value >= 1 AND rating_value <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(poll_id, user_id)  -- one response per user per poll
);

-- Indexes for poll_responses
CREATE INDEX IF NOT EXISTS idx_poll_responses_poll_id ON public.poll_responses(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_responses_user_id ON public.poll_responses(user_id);

-- Enable RLS
ALTER TABLE public.poll_responses ENABLE ROW LEVEL SECURITY;

-- RLS Policies for poll_responses:
-- Users can see responses for polls in their subjects
-- For non-anonymous polls, the poll creator (teacher) can see who responded
-- For anonymous polls, users can see that responses exist but not who submitted them
-- (Enforcement of anonymity is handled at the API/query level — RLS allows SELECT
--  for all subject members, and the API strips user_id for non-creators on anonymous polls)
DROP POLICY IF EXISTS "Subject members can view poll responses" ON public.poll_responses;
CREATE POLICY "Subject members can view poll responses" ON public.poll_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
      )
    )
  );

-- Users can INSERT their own response
DROP POLICY IF EXISTS "Users can submit own poll response" ON public.poll_responses;
CREATE POLICY "Users can submit own poll response" ON public.poll_responses
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id
      AND p.status = 'active'
      AND (
        p.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
        OR p.subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
      )
    )
  );

-- Users can UPDATE their own response (e.g., change vote)
DROP POLICY IF EXISTS "Users can update own poll response" ON public.poll_responses;
CREATE POLICY "Users can update own poll response" ON public.poll_responses
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can DELETE their own response
DROP POLICY IF EXISTS "Users can delete own poll response" ON public.poll_responses;
CREATE POLICY "Users can delete own poll response" ON public.poll_responses
  FOR DELETE USING (user_id = auth.uid());

-- Poll creator can delete any response on their poll (moderation)
DROP POLICY IF EXISTS "Poll creators can delete poll responses" ON public.poll_responses;
CREATE POLICY "Poll creators can delete poll responses" ON public.poll_responses
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_id AND p.created_by = auth.uid()
    )
  );


-- =====================================================
-- 5. HELPER FUNCTION: Auto-close expired polls
-- =====================================================
-- This function closes all polls whose closes_at timestamp
-- has passed. Can be called manually or via a scheduled job (pg_cron).
-- Client-side also handles this, but the DB function provides
-- a server-side safety net.

CREATE OR REPLACE FUNCTION public.auto_close_expired_polls()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_count INTEGER;
BEGIN
  UPDATE public.polls
  SET status = 'closed', updated_at = now()
  WHERE status = 'active'
    AND closes_at IS NOT NULL
    AND closes_at <= now();

  GET DIAGNOSTICS v_closed_count = ROW_COUNT;
  RETURN v_closed_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_expired_polls() TO authenticated;


-- =====================================================
-- 6. TRIGGER: Auto-close polls when closes_at is reached
-- =====================================================
-- Note: PostgreSQL triggers fire on DML events, not on time-based conditions.
-- This trigger handles the edge case where a poll's closes_at is set or
-- updated to a past timestamp — it immediately closes the poll.
-- For time-based expiration, use auto_close_expired_polls() with pg_cron
-- or call it from the API.

CREATE OR REPLACE FUNCTION public.check_poll_closes_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If closes_at is set and is in the past, close the poll immediately
  IF NEW.closes_at IS NOT NULL AND NEW.closes_at <= now() AND NEW.status = 'active' THEN
    NEW.status := 'closed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_poll_closes_at ON public.polls;
CREATE TRIGGER trg_check_poll_closes_at
  BEFORE INSERT OR UPDATE OF closes_at, status ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.check_poll_closes_at();


-- =====================================================
-- 7. ENABLE REALTIME for all 4 tables
-- =====================================================

ALTER TABLE public.user_todos REPLICA IDENTITY FULL;
ALTER TABLE public.polls REPLICA IDENTITY FULL;
ALTER TABLE public.poll_options REPLICA IDENTITY FULL;
ALTER TABLE public.poll_responses REPLICA IDENTITY FULL;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_todos; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.polls; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_options; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_responses; EXCEPTION WHEN OTHERS THEN NULL; END $$;


-- =====================================================
-- 8. ADD 'poll' NOTIFICATION TYPE
-- =====================================================
-- Extend the notifications type CHECK constraint to include 'poll'

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'assignment', 'grade', 'enrollment', 'file', 'file_request',
    'system', 'attendance', 'link_request', 'lecture', 'chat',
    'report', 'poll'
  ));
