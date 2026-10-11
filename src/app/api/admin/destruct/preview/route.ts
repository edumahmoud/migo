import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { verifyToken } from '../verify/route';

/**
 * GET /api/admin/destruct/preview
 *
 * Returns row counts for every table that CAN be deleted, grouped by
 * category. The UI uses this to show the admin exactly how many rows
 * will be destroyed before they confirm.
 *
 * Requires: superadmin auth + valid destruct-verify token (in
 * X-Destruct-Token header).
 *
 * Response: {
 *   success: true,
 *   categories: {
 *     users: { label, tables: [{ name, count }], total },
 *     academic: { ... },
 *     financial: { ... },
 *     communication: { ... },
 *     settings: { ... },
 *   },
 *   grandTotal: number
 * }
 */

// Helper: count rows in a table (service role bypasses RLS).
async function countRows(table: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.warn(`[preview] count error for ${table}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  // Verify the destruct token.
  const token = request.headers.get('x-destruct-token');
  if (!token || !verifyToken(token, auth.user.id)) {
    return NextResponse.json({ error: 'صلاحية الحذف منتهية أو غير صالحة' }, { status: 403 });
  }

  // Define categories + their tables.
  const categories = {
    users: {
      label: 'الحسابات المسجلة',
      tables: [
        'users', 'banned_users', 'student_suspensions', 'user_sessions',
        'user_folders', 'otp_codes', 'google_oauth_tokens',
        'teacher_student_links', 'registration_agents', 'registration_sources',
      ],
    },
    academic: {
      label: 'البيانات الأكاديمية',
      tables: [
        'subjects', 'subject_teachers', 'subject_students', 'subject_subscription_plans',
        'lectures', 'lecture_notes', 'note_views', 'lesson_units', 'lesson_progress',
        'lesson_attachments', 'lesson_notes', 'lesson_bookmarks', 'lesson_discussions',
        'lesson_versions', 'lesson_translations', 'summaries', 'quizzes', 'scores',
        'assignments', 'submissions', 'question_banks', 'bank_questions',
        'subject_videos', 'video_comments', 'video_views', 'attendance_sessions',
        'attendance_records', 'subject_teams', 'team_members', 'scorm_packages',
        'scorm_resources', 'scorm_tracking', 'scorm_package_subjects',
        'subject_files', 'user_files', 'file_shares', 'file_requests',
      ],
    },
    financial: {
      label: 'البيانات المالية',
      tables: [
        'orders', 'payments', 'order_fees', 'fee_catalog', 'financial_ledger',
        'commission_rates', 'teacher_payouts', 'teacher_payout_ledger_entries',
        'teacher_payout_audit_log', 'teacher_payout_methods',
        'teacher_payout_method_audit_log', 'payment_gateways',
        'payment_gateway_audit_log', 'payment_methods', 'user_report_stats',
      ],
    },
    communication: {
      label: 'البيانات التواصلية',
      tables: [
        'notifications', 'announcements', 'platform_announcements',
        'platform_announcement_views', 'conversations', 'conversation_participants',
        'messages', 'push_subscriptions', 'user_todos', 'polls', 'poll_options',
        'poll_responses', 'sticky_notes', 'reports', 'report_responses',
        'report_messages', 'teacher_supervisor_links',
      ],
    },
    settings: {
      label: 'إعدادات المنصة',
      tables: ['institution_settings'],
    },
    analytics: {
      label: 'بيانات التحليلات',
      tables: ['analytics_cache', 'analytics_snapshots', 'cohort_analytics_cache', 'app_config'],
    },
  };

  // Fetch counts for all tables in parallel.
  const result: Record<string, { label: string; tables: Array<{ name: string; count: number }>; total: number }> = {};
  let grandTotal = 0;

  for (const [catKey, cat] of Object.entries(categories)) {
    const tableCounts = await Promise.all(
      cat.tables.map(async (t) => ({ name: t, count: await countRows(t) }))
    );
    const catTotal = tableCounts.reduce((sum, t) => sum + t.count, 0);
    result[catKey] = { label: cat.label, tables: tableCounts, total: catTotal };
    grandTotal += catTotal;
  }

  return NextResponse.json({
    success: true,
    categories: result,
    grandTotal,
  });
}
