import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/migrate/manual-checkin
 * V5 Migration: Update check_in_method constraint to include 'manual',
 * and add RLS policy for teachers to insert attendance records for their sessions.
 */
export async function POST() {
  try {
    // Test if 'manual' is accepted in the check_in_method constraint
    // We'll try a dry-run by checking the constraint
    const { data: testSession } = await supabaseServer
      .from('attendance_sessions')
      .select('id')
      .limit(1);

    // Try to check if constraint allows 'manual' by attempting a validation query
    // We can't directly check constraints, but we can check if the column exists
    const { error: checkError } = await supabaseServer
      .from('attendance_records')
      .select('check_in_method')
      .limit(1);

    if (checkError) {
      return NextResponse.json({
        status: 'pending',
        message: 'check_in_method column does not exist. Run V4 migration first.',
        sql: `-- Run V4 migration first (v4_attendance_gps.sql)`,
      });
    }

    // The constraint update needs to be done via raw SQL in Supabase Dashboard
    // Return the SQL for manual execution
    return NextResponse.json({
      status: 'sql_required',
      message: 'Run this SQL in Supabase Dashboard SQL Editor to allow manual check-in:',
      sql: `
-- V5: Add 'manual' to check_in_method constraint
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_check_in_method_check;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_check_in_method_check
  CHECK (check_in_method IN ('qr', 'gps', 'manual'));

-- Allow teachers to insert attendance records for their own sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'attendance_records' AND policyname = 'Teachers can insert attendance for own sessions'
  ) THEN
    CREATE POLICY "Teachers can insert attendance for own sessions"
      ON public.attendance_records
      FOR INSERT
      WITH CHECK (
        session_id IN (
          SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid()
        )
      );
  END IF;
END $$;
      `.trim(),
      note: 'The manual registration feature works without this migration (uses server-side fallback), but the migration adds proper tracking with check_in_method = "manual" and allows client-side inserts too.',
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
