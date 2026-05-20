-- =====================================================
-- v35: Reports system + Teacher-Supervisor links
-- =====================================================

-- 1. Create teacher_supervisor_links table
-- Links teachers to supervisors (admins). A teacher can have multiple supervisors.
-- The supervisor who promoted the teacher gets is_primary = true automatically.
CREATE TABLE IF NOT EXISTS public.teacher_supervisor_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  supervisor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(teacher_id, supervisor_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_tsl_teacher_id ON public.teacher_supervisor_links(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tsl_supervisor_id ON public.teacher_supervisor_links(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_tsl_primary ON public.teacher_supervisor_links(teacher_id) WHERE is_primary = true;

-- RLS on teacher_supervisor_links
ALTER TABLE public.teacher_supervisor_links ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read links (needed for report routing)
DROP POLICY IF EXISTS "Authenticated users can read links" ON public.teacher_supervisor_links;
CREATE POLICY "Authenticated users can read links" ON public.teacher_supervisor_links
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins/superadmins can insert/update/delete links
DROP POLICY IF EXISTS "Admins can manage links" ON public.teacher_supervisor_links;
CREATE POLICY "Admins can manage links" ON public.teacher_supervisor_links
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  );


-- 2. Create reports table
-- The reporting chain: Student → Teacher → Supervisor(admin) → Superadmin
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('comment', 'message', 'user', 'other')),
  target_id UUID,              -- ID of the reported entity (comment, message, etc.)
  reason TEXT NOT NULL,         -- Brief reason (dropdown selection)
  description TEXT,             -- Detailed description
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'dismissed')),
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,  -- Who is currently handling the report
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON public.reports(assigned_to);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_target ON public.reports(target_type, target_id);

-- RLS on reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Users can read reports they submitted or are assigned to
DROP POLICY IF EXISTS "Users can view relevant reports" ON public.reports;
CREATE POLICY "Users can view relevant reports" ON public.reports
  FOR SELECT USING (
    auth.uid() = reporter_id
    OR auth.uid() = assigned_to
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  );

-- Authenticated users can create reports
DROP POLICY IF EXISTS "Authenticated users can create reports" ON public.reports;
CREATE POLICY "Authenticated users can create reports" ON public.reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id AND auth.uid() IS NOT NULL);

-- Assigned user or admin can update reports (status changes, assignments)
DROP POLICY IF EXISTS "Assigned users and admins can update reports" ON public.reports;
CREATE POLICY "Assigned users and admins can update reports" ON public.reports
  FOR UPDATE USING (
    auth.uid() = assigned_to
    OR auth.uid() = reporter_id
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  )
  WITH CHECK (
    auth.uid() = assigned_to
    OR auth.uid() = reporter_id
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  );


-- 3. Create report_responses table
-- Tracks replies, forwards, and status changes on reports
CREATE TABLE IF NOT EXISTS public.report_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  responder_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('reply', 'forward', 'resolve', 'dismiss', 'reopen')),
  content TEXT,                 -- Response content (for replies)
  forwarded_to UUID REFERENCES public.users(id) ON DELETE SET NULL,  -- Who the report is forwarded to
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_report_responses_report_id ON public.report_responses(report_id);
CREATE INDEX IF NOT EXISTS idx_report_responses_responder_id ON public.report_responses(responder_id);

-- RLS on report_responses
ALTER TABLE public.report_responses ENABLE ROW LEVEL SECURITY;

-- Users involved in the report can read responses
DROP POLICY IF EXISTS "Users can view report responses" ON public.report_responses;
CREATE POLICY "Users can view report responses" ON public.report_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.reporter_id = auth.uid()
        OR r.assigned_to = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );

-- Users involved in the report can add responses
DROP POLICY IF EXISTS "Users can add report responses" ON public.report_responses;
CREATE POLICY "Users can add report responses" ON public.report_responses
  FOR INSERT WITH CHECK (
    auth.uid() = responder_id
    AND EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_id
      AND (
        r.reporter_id = auth.uid()
        OR r.assigned_to = auth.uid()
        OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
      )
    )
  );


-- 4. Enable Realtime on reports and report_responses
ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;
ALTER PUBLICATION supabase_realtime ADD TABLE public.report_responses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.teacher_supervisor_links;

-- REPLICA IDENTITY FULL for Realtime DELETE support
ALTER TABLE public.reports REPLICA IDENTITY FULL;
ALTER TABLE public.report_responses REPLICA IDENTITY FULL;
ALTER TABLE public.teacher_supervisor_links REPLICA IDENTITY FULL;


-- 5. Add 'report' notification type
-- We'll handle this via the API rather than adding a DB CHECK constraint change,
-- since the notifications table uses a CHECK constraint on type.
-- The API will insert with type = 'report' and we need to update the CHECK constraint.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'file_request', 'system', 'attendance', 'link_request', 'lecture', 'chat', 'report'));


-- 6. Function: auto-assign report based on reporter's role
-- Students → their teacher; Teachers → their primary supervisor
-- Called when a new report is created
CREATE OR REPLACE FUNCTION public.auto_assign_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reporter_role TEXT;
  v_teacher_id UUID;
  v_supervisor_id UUID;
BEGIN
  -- Get reporter's role
  SELECT role INTO v_reporter_role FROM public.users WHERE id = NEW.reporter_id;

  IF v_reporter_role = 'student' THEN
    -- Assign to one of the student's teachers (the most recent linked teacher)
    SELECT tsl.teacher_id INTO v_teacher_id
    FROM public.teacher_student_links tsl
    WHERE tsl.student_id = NEW.reporter_id AND tsl.status = 'approved'
    ORDER BY tsl.created_at DESC
    LIMIT 1;

    IF v_teacher_id IS NOT NULL THEN
      NEW.assigned_to := v_teacher_id;
      NEW.status := 'pending';
    END IF;

  ELSIF v_reporter_role = 'teacher' THEN
    -- Assign to the teacher's primary supervisor
    SELECT tsl.supervisor_id INTO v_supervisor_id
    FROM public.teacher_supervisor_links tsl
    WHERE tsl.teacher_id = NEW.reporter_id AND tsl.is_primary = true
    LIMIT 1;

    IF v_supervisor_id IS NOT NULL THEN
      NEW.assigned_to := v_supervisor_id;
      NEW.status := 'pending';
    END IF;

  ELSIF v_reporter_role IN ('admin', 'superadmin') THEN
    -- Admin reports go to superadmin
    SELECT u.id INTO v_supervisor_id
    FROM public.users u
    WHERE u.role = 'superadmin'
    ORDER BY u.created_at
    LIMIT 1;

    IF v_supervisor_id IS NOT NULL THEN
      NEW.assigned_to := v_supervisor_id;
      NEW.status := 'pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger for auto-assignment
DROP TRIGGER IF EXISTS trg_auto_assign_report ON public.reports;
CREATE TRIGGER trg_auto_assign_report
  BEFORE INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_report();


-- 7. Function: create notification when report is assigned
CREATE OR REPLACE FUNCTION public.notify_report_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reporter_name TEXT;
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    -- Get reporter name
    SELECT name INTO v_reporter_name FROM public.users WHERE id = NEW.reporter_id;

    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      NEW.assigned_to,
      'report',
      'إبلاغ جديد',
      COALESCE(v_reporter_name, 'مستخدم') || ' قام بتقديم إبلاغ جديد',
      '/reports/' || NEW.id,
      false
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_report_assigned ON public.reports;
CREATE TRIGGER trg_notify_report_assigned
  AFTER INSERT OR UPDATE OF assigned_to ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_report_assigned();
