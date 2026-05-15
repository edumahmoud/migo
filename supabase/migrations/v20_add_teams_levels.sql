-- =====================================================
-- v20: Add teams/levels for courses
-- =====================================================

-- Teams within a subject/course
CREATE TABLE IF NOT EXISTS subject_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level TEXT,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE(subject_id, name)
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES subject_teams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(team_id, student_id)
);

-- RLS policies
ALTER TABLE subject_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Teachers can manage teams in their subjects
CREATE POLICY "Teachers can manage teams" ON subject_teams
  FOR ALL USING (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM subject_teachers WHERE subject_id = subject_teams.subject_id AND teacher_id = auth.uid())
    OR public.is_admin()
  );

-- Students can read teams they belong to
CREATE POLICY "Students can read their teams" ON subject_teams
  FOR SELECT USING (
    subject_id IN (SELECT subject_id FROM subject_students WHERE student_id = auth.uid() AND status = 'approved')
    OR subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  );

-- Team members readable by participants
CREATE POLICY "Team members readable by participants" ON team_members
  FOR SELECT USING (
    team_id IN (SELECT id FROM subject_teams WHERE subject_id IN (
      SELECT subject_id FROM subject_students WHERE student_id = auth.uid() AND status = 'approved'
      UNION
      SELECT id FROM subjects WHERE teacher_id = auth.uid()
    ))
  );

-- Teachers can manage team members
CREATE POLICY "Teachers can manage team members" ON team_members
  FOR ALL USING (
    team_id IN (SELECT id FROM subject_teams WHERE subject_id IN (
      SELECT id FROM subjects WHERE teacher_id = auth.uid()
      UNION
      SELECT subject_id FROM subject_teachers WHERE teacher_id = auth.uid()
    ))
    OR public.is_admin()
  );
