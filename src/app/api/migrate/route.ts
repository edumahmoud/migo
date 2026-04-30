import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/migrate
 * Runs pending database migrations for attendance GPS features.
 * Uses the Supabase service role key via the REST API.
 */
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
  }

  // We'll try to verify if the columns exist and report status
  // The actual migration needs to be run from the Supabase Dashboard SQL Editor
  try {
    // Check if columns exist by trying to select them
    const checkUrl = `${supabaseUrl}/rest/v1/attendance_sessions?select=id,teacher_latitude,teacher_longitude&limit=1`;
    const checkResp = await fetch(checkUrl, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (checkResp.ok) {
      return NextResponse.json({ 
        status: 'migrated', 
        message: 'GPS columns already exist' 
      });
    }

    const errorData = await checkResp.json();
    if (errorData.message?.includes('does not exist')) {
      return NextResponse.json({ 
        status: 'pending', 
        message: 'Migration required. Please run the SQL in Supabase Dashboard SQL Editor.',
        sql: `
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS teacher_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS teacher_longitude DOUBLE PRECISION;

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS student_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS student_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_method TEXT;

ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.attendance_records;
        `.trim()
      });
    }

    return NextResponse.json({ status: 'error', message: errorData.message }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ 
      status: 'error', 
      message: err instanceof Error ? err.message : 'Unknown error' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/migrate
 * Migrate lecture_notes file references from old [FILE:url:name] to new [FILE|||url|||name] format.
 * The old format breaks because URLs contain ':' (like https://...).
 */
export async function PUT() {
  try {
    const { data: notes, error: fetchError } = await supabaseServer
      .from('lecture_notes')
      .select('id, content')
      .like('content', '[FILE:%');

    if (fetchError) {
      return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 });
    }

    if (!notes || notes.length === 0) {
      return NextResponse.json({ success: true, migrated: 0, message: 'No notes to migrate' });
    }

    let migrated = 0;
    for (const note of notes) {
      const content = note.content as string;
      // Skip if already using new format
      if (content.startsWith('[FILE|||')) continue;

      // Old format: [FILE:https://example.com/path/file.pdf:اسم عربي.pdf]
      const match = content.match(/^\[FILE:(https?:\/\/.+):(.+?)\]$/);
      if (match) {
        const newContent = `[FILE|||${match[1]}|||${match[2]}]`;
        const { error: updateError } = await supabaseServer
          .from('lecture_notes')
          .update({ content: newContent })
          .eq('id', note.id);

        if (!updateError) migrated++;
        else console.error(`Failed to migrate note ${note.id}:`, updateError);
      }
    }

    return NextResponse.json({
      success: true,
      migrated,
      total: notes.length,
      message: `Migrated ${migrated} of ${notes.length} file notes`,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ success: false, error: 'Migration failed' }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}

/**
 * PATCH /api/migrate
 * Add visibility column to user_files table if not exists.
 * Also creates index for faster lookups.
 */
export async function PATCH() {
  try {
    // Check if visibility column exists
    const { data, error } = await supabaseServer
      .from('user_files')
      .select('id, visibility')
      .limit(1);

    if (error) {
      // Column likely doesn't exist - try to add it via SQL
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceKey) {
        return NextResponse.json({
          status: 'pending',
          message: 'Run this SQL in Supabase Dashboard SQL Editor:',
          sql: `ALTER TABLE public.user_files ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';`,
        });
      }

      // Try running the full migration SQL via Supabase SQL API
      try {
        const sqlResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/v7_migrate_visibility`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (sqlResponse.ok) {
          return NextResponse.json({
            status: 'migrated',
            message: 'Visibility column and index created successfully',
          });
        }
      } catch {
        // RPC function doesn't exist, fall through
      }

      return NextResponse.json({
        status: 'pending',
        message: 'Run this SQL in Supabase Dashboard SQL Editor:',
        sql: `
ALTER TABLE public.user_files
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
CHECK (visibility IN ('public', 'private'));

CREATE INDEX IF NOT EXISTS idx_user_files_visibility ON user_files(visibility);
        `.trim(),
      });
    }

    return NextResponse.json({
      status: 'migrated',
      message: 'visibility column already exists on user_files',
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * DELETE /api/migrate
 * V8 Migration: Add status column to subject_students for enrollment approval flow.
 * Default is 'approved' so existing enrollments remain active.
 */
export async function DELETE() {
  try {
    // Check if status column exists
    const { data, error } = await supabaseServer
      .from('subject_students')
      .select('id, status')
      .limit(1);

    if (!error) {
      return NextResponse.json({
        status: 'migrated',
        message: 'status column already exists on subject_students',
      });
    }

    // Column doesn't exist - return SQL for manual execution
    return NextResponse.json({
      status: 'pending',
      message: 'Run this SQL in Supabase Dashboard SQL Editor to add the enrollment status column:',
      sql: `
-- V8: Add status column to subject_students for enrollment approval flow
ALTER TABLE subject_students
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
CHECK (status IN ('pending', 'approved', 'rejected'));

-- Create index for faster pending lookups
CREATE INDEX IF NOT EXISTS idx_subject_students_status ON subject_students(subject_id, status);

-- Drop existing conflicting policies
DROP POLICY IF EXISTS "Students can request enrollment" ON subject_students;
DROP POLICY IF EXISTS "Teachers can manage enrollment status" ON subject_students;
DROP POLICY IF EXISTS "Teachers can remove students" ON subject_students;
DROP POLICY IF EXISTS "View enrollments" ON subject_students;

-- Policy: Students can insert their own enrollment (pending only)
-- OR teachers can insert students into their own subjects
CREATE POLICY "Insert enrollment"
  ON subject_students
  FOR INSERT
  WITH CHECK (
    (student_id = auth.uid() AND status = 'pending')
    OR
    (subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid()))
  );

-- Policy: Teachers can update enrollment status for their subjects
CREATE POLICY "Teachers can manage enrollment status"
  ON subject_students
  FOR UPDATE
  USING (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  )
  WITH CHECK (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  );

-- Policy: Teachers can delete students from their subjects, or students can remove themselves
CREATE POLICY "Teachers can remove students"
  ON subject_students
  FOR DELETE
  USING (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
    OR student_id = auth.uid()
  );

-- Policy: Anyone can view enrollments for subjects they belong to
CREATE POLICY "View enrollments"
  ON subject_students
  FOR SELECT
  USING (
    student_id = auth.uid()
    OR subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  );
      `.trim(),
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
