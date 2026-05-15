-- =====================================================
-- Examy - V2 Addons: Attendance, Notifications, User Sessions
-- =====================================================
-- Idempotent migration: safe to re-run (uses DROP IF EXISTS + CREATE IF NOT EXISTS)
-- Depends on existing tables: users, subjects, lectures

-- =====================================================
-- 1. ATTENDANCE SESSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lecture_id UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enforce: only ONE active session per teacher at a time (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_session_per_teacher
  ON public.attendance_sessions(teacher_id) WHERE status = 'active';

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_lecture_id ON public.attendance_sessions(lecture_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_teacher_id ON public.attendance_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_subject_id ON public.attendance_sessions(subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_status ON public.attendance_sessions(status);

-- =====================================================
-- 2. ATTENDANCE RECORDS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(session_id, student_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_records_session_id ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_id ON public.attendance_records(student_id);

-- =====================================================
-- 3. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'system', 'attendance')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);

-- =====================================================
-- 4. USER SESSIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_activity TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON public.user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_device_fingerprint ON public.user_sessions(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON public.user_sessions(last_activity);

-- =====================================================
-- Enable RLS on all new tables (idempotent)
-- =====================================================
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies for attendance_sessions
-- =====================================================

-- Teachers can view their own sessions
DROP POLICY IF EXISTS "Teachers can view own attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Teachers can view own attendance sessions" ON public.attendance_sessions
  FOR SELECT USING (teacher_id = auth.uid());

-- Students can view sessions for their enrolled subjects
DROP POLICY IF EXISTS "Students can view attendance sessions in enrolled subjects" ON public.attendance_sessions;
CREATE POLICY "Students can view attendance sessions in enrolled subjects" ON public.attendance_sessions
  FOR SELECT USING (
    subject_id IN (SELECT subject_id FROM public.subject_students WHERE student_id = auth.uid())
  );

-- Teachers can create sessions for their own subjects
DROP POLICY IF EXISTS "Teachers can create attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Teachers can create attendance sessions" ON public.attendance_sessions
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid() AND
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

-- Teachers can update own sessions (e.g., end session)
DROP POLICY IF EXISTS "Teachers can update own attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Teachers can update own attendance sessions" ON public.attendance_sessions
  FOR UPDATE USING (teacher_id = auth.uid());

-- Teachers can delete own sessions
DROP POLICY IF EXISTS "Teachers can delete own attendance sessions" ON public.attendance_sessions;
CREATE POLICY "Teachers can delete own attendance sessions" ON public.attendance_sessions
  FOR DELETE USING (teacher_id = auth.uid());

-- =====================================================
-- RLS Policies for attendance_records
-- =====================================================

-- Teachers can view records for their sessions
DROP POLICY IF EXISTS "Teachers can view attendance records for own sessions" ON public.attendance_records;
CREATE POLICY "Teachers can view attendance records for own sessions" ON public.attendance_records
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid())
  );

-- Students can view their own records
DROP POLICY IF EXISTS "Students can view own attendance records" ON public.attendance_records;
CREATE POLICY "Students can view own attendance records" ON public.attendance_records
  FOR SELECT USING (student_id = auth.uid());

-- Students can check in (insert own record) for sessions in their enrolled subjects
DROP POLICY IF EXISTS "Students can check in to attendance" ON public.attendance_records;
CREATE POLICY "Students can check in to attendance" ON public.attendance_records
  FOR INSERT WITH CHECK (
    student_id = auth.uid() AND
    session_id IN (
      SELECT as2.id FROM public.attendance_sessions as2
      WHERE as2.subject_id IN (SELECT subject_id FROM public.subject_students WHERE student_id = auth.uid())
      AND as2.status = 'active'
    )
  );

-- Teachers can delete records for their sessions
DROP POLICY IF EXISTS "Teachers can delete attendance records for own sessions" ON public.attendance_records;
CREATE POLICY "Teachers can delete attendance records for own sessions" ON public.attendance_records
  FOR DELETE USING (
    session_id IN (SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid())
  );

-- =====================================================
-- RLS Policies for notifications
-- =====================================================

-- Users can view their own notifications
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- System can create notifications (any authenticated user for system purposes)
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
CREATE POLICY "System can create notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Users can update own notifications (mark as read)
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete own notifications
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- RLS Policies for user_sessions
-- =====================================================

-- Users can view own sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON public.user_sessions;
CREATE POLICY "Users can view own sessions" ON public.user_sessions
  FOR SELECT USING (user_id = auth.uid());

-- Users can create own sessions
DROP POLICY IF EXISTS "Users can create own sessions" ON public.user_sessions;
CREATE POLICY "Users can create own sessions" ON public.user_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update own sessions (e.g., last_activity, is_active)
DROP POLICY IF EXISTS "Users can update own sessions" ON public.user_sessions;
CREATE POLICY "Users can update own sessions" ON public.user_sessions
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete own sessions
DROP POLICY IF EXISTS "Users can delete own sessions" ON public.user_sessions;
CREATE POLICY "Users can delete own sessions" ON public.user_sessions
  FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- Grant permissions
-- =====================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- =====================================================
-- Triggers: auto-update updated_at for new tables
-- =====================================================

-- attendance_sessions updated_at trigger
DROP TRIGGER IF EXISTS trg_attendance_sessions_updated_at ON public.attendance_sessions;
CREATE TRIGGER trg_attendance_sessions_updated_at
  BEFORE UPDATE ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =====================================================
-- Enable realtime for attendance and notifications
-- (idempotent - will fail silently if already added)
-- =====================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
