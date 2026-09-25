import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/auth/my-enrollments
 *
 * Diagnostic endpoint that returns the authenticated student's
 * subject_students rows. Used to debug "courses not appearing"
 * after a paid subscription is approved.
 *
 * Returns:
 *   - user_id           (auth.uid() — what the client sees)
 *   - profile            (users table row for this ID)
 *   - subject_students   (rows where student_id = auth.uid())
 *   - count              (number of rows)
 *   - subjects           (subject_ids resolved to subject names)
 *   - rls_test           (whether RLS allows the read)
 *
 * Compare `user_id` with `subject_students[].student_id` — if they
 * don't match, the order was created with a different student_id
 * (e.g., a teacher-registered student vs. the auth.uid()).
 *
 * Compare `count` with the actual paid orders — if count=0 but
 * orders exist with status='paid', the RPC's INSERT into
 * subject_students failed silently OR v70 columns are missing.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const userId = auth.user.id;

  // 1. Fetch profile from users table
  const { data: profile, error: profileErr } = await supabaseServer
    .from('users')
    .select('id, email, name, role, account_status, phone, phone_verified, student_code')
    .eq('id', userId)
    .maybeSingle();

  // 2. Count + fetch subject_students rows via service role (bypasses RLS)
  const { data: enrollments, error: enrollErr, count } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, student_id, status, enrollment_method, enrolled_at, current_period_start, current_period_end, next_billing_at, monthly_price', { count: 'exact' })
    .eq('student_id', userId)
    .order('enrolled_at', { ascending: false });

  // 3. Fetch orders to see what's actually paid
  const { data: orders } = await supabaseServer
    .from('orders')
    .select('id, subject_id, student_id, amount, currency, status, confirmation_mode, created_at, paid_at, activated_at')
    .eq('student_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  // 4. Fetch subject names for the enrollments
  const subjectIds = (enrollments ?? []).map((e: { subject_id: string }) => e.subject_id);
  let subjects: Array<{ id: string; name: string; teacher_id: string }> = [];
  if (subjectIds.length > 0) {
    const { data: subjectRows } = await supabaseServer
      .from('subjects')
      .select('id, name, teacher_id')
      .in('id', subjectIds);
    subjects = subjectRows as Array<{ id: string; name: string; teacher_id: string }> ?? [];
  }

  // 5. Detect mismatches
  const profileErr2 = profileErr ? profileErr.message : null;
  const enrollErr2 = enrollErr ? enrollErr.message : null;
  const profileId = (profile as { id?: string } | null)?.id;
  const idMismatch = profileId && profileId !== userId;

  // 6. Check if v70 columns exist (if error mentions column not existing)
  const v70Missing = enrollErr2
    ? /current_period_start|current_period_end|next_billing_at|monthly_price/.test(enrollErr2)
    : false;

  // 7. Check active subscriptions (period_end > now OR NULL = permanent)
  const now = new Date();
  const activeSubscriptions = (enrollments ?? []).filter((e: { current_period_end?: string | null; status: string }) => {
    if (e.status !== 'approved') return false;
    if (!e.current_period_end) return true; // permanent access
    return new Date(e.current_period_end) > now;
  });

  // 8. Compose verdict
  let verdict = '';
  if (profileErr) {
    verdict = `❌ تعذّر قراءة الملف الشخصي: ${profileErr2}`;
  } else if (!profile) {
    verdict = `❌ الملف الشخصي غير موجود للمستخدم ${userId}`;
  } else if ((profile as { role: string }).role !== 'student') {
    verdict = `❌ الحساب دوره ${(profile as { role: string }).role} (وليس student) — لا يمكن استخدام هذا الـ endpoint`;
  } else if (idMismatch) {
    verdict = `❌ تطابق مفقود: profile.id=${profileId} لكن auth.uid()=${userId}. السبب على الأرجح: trigger handle_new_user لم يُنشئ صف users`;
  } else if (v70Missing) {
    verdict = `❌ أعمدة v70 (current_period_start/end, next_billing_at, monthly_price) غير موجودة. شغّل supabase/migrations/v70_monthly_subscriptions.sql في Supabase SQL Editor`;
  } else if ((count ?? 0) === 0) {
    const paidOrders = (orders ?? []).filter((o: { status: string }) => o.status === 'paid');
    if (paidOrders.length > 0) {
      verdict = `❌ توجد ${paidOrders.length} طلبات بحالة 'paid' ولكن لا توجد صفوف في subject_students. السبب على الأرجح: فشل RPC activate_subscription_after_payment في إدراج صف الاشتراك (تحقق من v70 migration + v68 RPC).`;
    } else {
      verdict = `⚠️ لا توجد اشتراكات في subject_students ولا طلبات بحالة 'paid'. تأكد أن المشرف قد اعتمد الطلبات فعلاً.`;
    }
  } else if (activeSubscriptions.length === 0) {
    verdict = `⚠️ توجد ${(count ?? 0)} صف في subject_students لكن صفر منها 'active' (جميعها منتهية الصلاحية أو ليست approved).`;
  } else {
    verdict = `✅ يوجد ${(count ?? 0)} صف اشتراك، منها ${activeSubscriptions.length} نشط حالياً.`;
  }

  return NextResponse.json({
    user_id: userId,
    profile_id: profileId,
    id_match: !idMismatch,
    account_status: (profile as { account_status?: string } | null)?.account_status,
    role: (profile as { role?: string } | null)?.role,
    phone_verified: (profile as { phone_verified?: boolean } | null)?.phone_verified,
    student_code: (profile as { student_code?: string } | null)?.student_code,
    subject_students: enrollments ?? [],
    subject_students_count: count ?? 0,
    active_subscriptions_count: activeSubscriptions.length,
    subjects,
    recent_orders: orders ?? [],
    errors: {
      profile_error: profileErr2,
      enrollment_error: enrollErr2,
    },
    verdict,
  });
}
