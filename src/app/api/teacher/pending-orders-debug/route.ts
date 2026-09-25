import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/pending-orders-debug
 *
 * Diagnostic endpoint that returns EVERYTHING the supervisor needs to
 * debug "orders visible to student but not to supervisor":
 *
 *   - supervisor role + user_id
 *   - agent's teacher_id (resolved from registration_agents)
 *   - teacher's subject count + sample subject IDs
 *   - count of ALL pending orders for these subjects (any confirmation_mode)
 *   - count of pending manual orders
 *   - count of pending automatic orders
 *   - sample of pending orders with their confirmation_mode
 *   - whether v75 columns exist on orders table
 *
 * No filters applied — shows ALL data so the operator can spot
 * mismatches (e.g., orders converted to automatic mode by mistake).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (!role || !['teacher', 'admin', 'superadmin', 'registration_agent'].includes(role)) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  // 1. Resolve teacher_id
  let teacherId: string | null = null;
  if (role === 'teacher') {
    teacherId = auth.user.id;
  } else if (role === 'registration_agent') {
    const { data: agent } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id, is_active, source_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    teacherId = (agent as { teacher_id: string | null } | null)?.teacher_id ?? null;
  } else {
    // admin/superadmin — would need to specify a teacher_id via query param
    const paramTeacherId = request.nextUrl.searchParams.get('teacher_id');
    teacherId = paramTeacherId || null;
  }

  if (!teacherId) {
    return NextResponse.json({
      success: false,
      role,
      user_id: auth.user.id,
      error: 'تعذر تحديد المعلم المرتبط بحسابك',
    }, { status: 403 });
  }

  // 2. Teacher's subjects
  const { data: subjects, error: subErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id')
    .eq('teacher_id', teacherId);
  const subjectIds = ((subjects ?? []) as Array<{ id: string }>).map((s) => s.id);

  // 3. Check v75 columns
  const { data: cols, error: colsErr } = await supabaseServer
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_name', 'orders')
    .eq('table_schema', 'public')
    .in('column_name', ['sender_name', 'transaction_ref', 'proof_notes', 'proof_submitted_at', 'proof_url']);
  const v75Columns = (cols ?? []).map((c: { column_name: string }) => c.column_name);
  const v75Applied = v75Columns.length === 5;

  // 4. ALL pending orders for these subjects (any confirmation_mode)
  let allPendingOrders: Array<Record<string, unknown>> = [];
  let pendingByMode = { manual: 0, automatic: 0, total: 0 };
  if (subjectIds.length > 0) {
    const { data: orders, error: ordersErr } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, currency, status, confirmation_mode, created_at')
      .in('subject_id', subjectIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!ordersErr) {
      allPendingOrders = (orders ?? []) as Array<Record<string, unknown>>;
      pendingByMode = {
        manual: allPendingOrders.filter((o) => o.confirmation_mode === 'manual').length,
        automatic: allPendingOrders.filter((o) => o.confirmation_mode === 'automatic').length,
        total: allPendingOrders.length,
      };
    }
  }

  // 5. Verdict
  let verdict = '';
  if (subjectIds.length === 0) {
    verdict = `❌ لا توجد مقررات للمعلم ${teacherId}. المشرف لن يرى أي طلبات لأن المعلم لا يملك مقررات.`;
  } else if (pendingByMode.total === 0) {
    verdict = `⚠️ المعلم ${teacherId} لديه ${subjectIds.length} مقرر، لكن لا توجد طلبات pending لأي منها. تحقق أن الطلاب قد أنشأوا طلبات فعلاً.`;
  } else if (pendingByMode.manual === 0 && pendingByMode.automatic > 0) {
    verdict = `⚠️ توجد ${pendingByMode.automatic} طلبات pending بصيغة 'automatic' (للدفع الفوري عبر البطاقة). المشاف لا يراها لأن الاستعلام يفلتر بـ confirmation_mode='manual'. قد يكون الطلاب ضغطوا زر "دفع فوري" لكن لم يكملوا الدفع.`;
  } else if (pendingByMode.manual > 0) {
    verdict = `✅ يوجد ${pendingByMode.manual} طلبات pending بصيغة 'manual' يجب أن تظهر للمشرف. لو لا تظهر، تحقق من الـ PendingOrdersSection في الواجهة.`;
  } else {
    verdict = `حالة غير معروفة. total=${pendingByMode.total}`;
  }

  if (!v75Applied) {
    verdict += `\n\n⚠️ migration v75 غير مُطبَّقة — الأعمدة التالية ناقصة: sender_name, transaction_ref, proof_notes, proof_submitted_at, proof_url. شغّل supabase/migrations/v75_payment_proof.sql في SQL Editor.`;
  }

  return NextResponse.json({
    success: true,
    supervisor: {
      user_id: auth.user.id,
      role,
      resolved_teacher_id: teacherId,
    },
    teacher_subjects: {
      count: subjectIds.length,
      sample_ids: subjectIds.slice(0, 5),
    },
    v75_columns_present: v75Applied,
    v75_columns_found: v75Columns,
    pending_orders_summary: pendingByMode,
    pending_orders_sample: allPendingOrders.slice(0, 10),
    verdict,
  });
}
