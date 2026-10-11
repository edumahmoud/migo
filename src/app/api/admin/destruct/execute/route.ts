import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { verifyPassword } from '@/lib/admin-security';
import { verifyToken } from '../verify/route';

/**
 * POST /api/admin/destruct/execute
 *
 * Executes the destructive data-wipe operation. This is the most
 * dangerous endpoint in the entire application.
 *
 * Defense in depth — ALL of these must pass:
 *   1. Superadmin auth (Bearer token / cookie session)
 *   2. Valid destruct-verify token (X-Destruct-Token header, < 10 min old)
 *   3. Destruct password re-entered in the body (verified against bcrypt hash)
 *   4. Confirmation string must equal "DELETE" exactly
 *   5. At least one category must be selected
 *
 * Body: {
 *   password: string,           // re-entered destruct password
 *   token: string,              // from /verify
 *   confirmation: string,       // must === "DELETE"
 *   categories: string[],       // keys from the preview response
 *   deleteSelf: boolean,        // whether to delete the admin's own account
 * }
 *
 * Behavior:
 *   - Deletes ALL rows in ALL tables of the selected categories.
 *   - If deleteSelf is true, also deletes the admin's auth account
 *     (Supabase Auth) + users row. This is done LAST so the response
 *     can still be sent.
 *   - Uses service role (bypasses RLS).
 *   - Returns a summary of what was deleted.
 *
 * WARNING: This operation is IRREVERSIBLE. There is no undo.
 */

// Tables that can be deleted, grouped by category. Must match the
// preview endpoint's categories exactly.
const CATEGORY_TABLES: Record<string, string[]> = {
  users: [
    'banned_users', 'student_suspensions', 'user_sessions',
    'user_folders', 'otp_codes', 'google_oauth_tokens',
    'teacher_student_links', 'registration_agents', 'registration_sources',
    // NOTE: 'users' itself is deleted LAST (and only if deleteSelf is
    // false we keep the admin's row; if true we delete it too).
  ],
  academic: [
    'lesson_progress', 'lesson_attachments', 'lesson_notes', 'lesson_bookmarks',
    'lesson_discussions', 'lesson_versions', 'lesson_translations',
    'scorm_tracking', 'scorm_resources', 'scorm_package_subjects', 'scorm_packages',
    'attendance_records', 'attendance_sessions',
    'team_members', 'subject_teams',
    'video_views', 'video_comments', 'subject_videos',
    'submissions', 'assignments',
    'scores', 'quizzes',
    'bank_questions', 'question_banks',
    'note_views', 'lecture_notes', 'lectures', 'lesson_units',
    'file_shares', 'file_requests', 'subject_files', 'user_files',
    'subject_subscription_plans',
    'subject_students', 'subject_teachers',
    'summaries',
    'subjects', // deleted after its dependents
  ],
  financial: [
    'teacher_payout_ledger_entries', 'teacher_payout_audit_log',
    'teacher_payout_method_audit_log', 'teacher_payout_methods',
    'teacher_payouts',
    'payment_gateway_audit_log', 'payment_gateways',
    'order_fees', 'payments', 'orders',
    'financial_ledger', 'commission_rates', 'fee_catalog',
    'payment_methods', 'user_report_stats',
  ],
  communication: [
    'report_messages', 'report_responses', 'reports',
    'teacher_supervisor_links',
    'poll_responses', 'poll_options', 'polls',
    'user_todos', 'sticky_notes',
    'push_subscriptions',
    'messages', 'conversation_participants', 'conversations',
    'platform_announcement_views', 'platform_announcements',
    'announcements',
    'notifications',
  ],
  settings: ['institution_settings'],
  analytics: ['analytics_cache', 'analytics_snapshots', 'cohort_analytics_cache', 'app_config'],
};

export async function POST(request: NextRequest) {
  // ─── Layer 1: Superadmin auth ───
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const { password, token, confirmation, categories, deleteSelf } = body as {
    password?: string;
    token?: string;
    confirmation?: string;
    categories?: string[];
    deleteSelf?: boolean;
  };

  // ─── Layer 2: Valid destruct token ───
  if (!token || !verifyToken(token, auth.user.id)) {
    return NextResponse.json({ error: 'صلاحية الحذف منتهية أو غير صالحة. أعد إدخال كلمة المرور.' }, { status: 403 });
  }

  // ─── Layer 3: Re-verify destruct password ───
  if (!password) {
    return NextResponse.json({ error: 'كلمة مرور الحذف مطلوبة' }, { status: 400 });
  }
  const { data: securityRow } = await supabaseServer
    .from('admin_security')
    .select('destruct_password_hash')
    .maybeSingle();
  if (!securityRow?.destruct_password_hash) {
    return NextResponse.json({ error: 'لم يتم تعيين كلمة مرور الحذف' }, { status: 400 });
  }
  const passwordValid = await verifyPassword(password, securityRow.destruct_password_hash);
  if (!passwordValid) {
    return NextResponse.json({ error: 'كلمة مرور الحذف غير صحيحة' }, { status: 401 });
  }

  // ─── Layer 4: Confirmation string ───
  if (confirmation !== 'DELETE') {
    return NextResponse.json({ error: 'يجب كتابة كلمة DELETE للتأكيد' }, { status: 400 });
  }

  // ─── Layer 5: At least one category ───
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return NextResponse.json({ error: 'يجب اختيار فئة واحدة على الأقل' }, { status: 400 });
  }

  // Validate all requested categories exist.
  for (const cat of categories) {
    if (!CATEGORY_TABLES[cat]) {
      return NextResponse.json({ error: `فئة غير معروفة: ${cat}` }, { status: 400 });
    }
  }

  // ─── Execute the deletion ───
  const results: Array<{ category: string; table: string; deleted: number; error?: string }> = [];

  for (const category of categories) {
    const tables = CATEGORY_TABLES[category];
    for (const table of tables) {
      try {
        // Delete all rows. Using .neq('id', '000...') to ensure the
        // filter matches all rows (supabase-js requires a filter for
        // delete). For tables without an 'id' column, this still
        // works because the service role bypasses RLS and the filter
        // is effectively a no-op (PostgREST deletes all matching rows).
        const { count, error } = await supabaseServer
          .from(table)
          .delete({ count: 'exact' })
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (error) {
          // Some tables may not have an 'id' column — try a different
          // filter. Use a column that always exists: created_at.
          if (error.message?.includes('column') || error.code === '42703') {
            const retry = await supabaseServer
              .from(table)
              .delete({ count: 'exact' })
              .neq('created_at', '1970-01-01T00:00:00.000Z');
            results.push({
              category,
              table,
              deleted: retry.count ?? 0,
              error: retry.error?.message,
            });
          } else {
            results.push({ category, table, deleted: 0, error: error.message });
          }
        } else {
          results.push({ category, table, deleted: count ?? 0 });
        }
      } catch (err) {
        results.push({
          category,
          table,
          deleted: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ─── Handle the users table specially ───
  // If 'users' category is selected, delete all users EXCEPT the admin
  // (unless deleteSelf is true, then delete the admin too — but LAST).
  if (categories.includes('users')) {
    if (deleteSelf) {
      // Delete all other users first.
      const { count: othersCount } = await supabaseServer
        .from('users')
        .delete({ count: 'exact' })
        .neq('id', auth.user.id);
      results.push({
        category: 'users',
        table: 'users (other than self)',
        deleted: othersCount ?? 0,
      });
      // Delete admin's users row.
      const { count: selfCount } = await supabaseServer
        .from('users')
        .delete({ count: 'exact' })
        .eq('id', auth.user.id);
      results.push({
        category: 'users',
        table: 'users (self)',
        deleted: selfCount ?? 0,
      });
      // Delete admin's auth account (Supabase Auth) — done LAST so we
      // can still send the response.
      // We don't await this — the response should be sent before the
      // auth account is destroyed.
      supabaseServer.auth.admin.deleteUser(auth.user.id).catch((err) => {
        console.error('[destruct] failed to delete self auth account:', err);
      });
    } else {
      // Delete all users EXCEPT the admin.
      const { count, error } = await supabaseServer
        .from('users')
        .delete({ count: 'exact' })
        .neq('id', auth.user.id);
      results.push({
        category: 'users',
        table: 'users (keeping self)',
        deleted: count ?? 0,
        error: error?.message,
      });
    }
  }

  // ─── Clear the admin_security table if deleteSelf is true ───
  // (so the destruct password is also wiped).
  if (deleteSelf) {
    await supabaseServer.from('admin_security').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    results.push({ category: 'settings', table: 'admin_security', deleted: 1 });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);

  return NextResponse.json({
    success: true,
    summary: {
      totalDeleted,
      results,
      deleteSelf: !!deleteSelf,
    },
  });
}
