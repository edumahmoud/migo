import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * GET /api/migrate/link-request-notifications
 * V11 Migration: Enable realtime for teacher_student_links & add 'link_request' notification type.
 *
 * Checks if the migration has been applied and returns status.
 * If pending, returns the SQL that needs to be run in Supabase Dashboard SQL Editor.
 */
export async function GET() {
  try {
    // Check if 'link_request' type is allowed by trying to query notifications with that type
    // If the constraint doesn't include 'link_request', this won't error but we can test with an insert
    const { error: testError } = await supabaseServer
      .from('notifications')
      .insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        type: 'link_request',
        title: 'migration-test',
        message: 'test',
      })
      .select();

    if (testError) {
      // Check if it's a constraint violation
      if (testError.code === '23514' || testError.message?.includes('check constraint')) {
        return NextResponse.json({
          status: 'pending',
          message: 'الرجاء تشغيل SQL التالي في محرر SQL بلوحة تحكم Supabase:',
          sql: `
-- V11: Enable realtime for teacher_student_links & add 'link_request' notification type

-- 1. Add teacher_student_links to the realtime publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.teacher_student_links;
  RAISE NOTICE 'teacher_student_links table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'teacher_student_links may already be in supabase_realtime: %', SQLERRM;
END $$;

-- 2. Add 'link_request' to notifications type check constraint
ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'system', 'attendance', 'link_request'));
          `.trim(),
        });
      }

      // FK error means the constraint already allows 'link_request' (just the fake user_id doesn't exist)
      if (testError.code === '23503') {
        return NextResponse.json({
          status: 'migrated',
          message: 'link_request notification type متاح بالفعل في قاعدة البيانات',
        });
      }

      return NextResponse.json({
        status: 'error',
        message: testError.message,
      });
    }

    // Insert succeeded (shouldn't happen with fake user_id, but just in case)
    // Clean up the test notification
    await supabaseServer
      .from('notifications')
      .delete()
      .eq('title', 'migration-test');

    return NextResponse.json({
      status: 'migrated',
      message: 'link_request notification type متاح بالفعل في قاعدة البيانات',
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 });
  }
}
