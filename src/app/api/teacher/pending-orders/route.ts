import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/pending-orders
 *
 * Lists all PENDING manual-confirmation orders for the requesting
 * teacher's courses. Also accessible by registration_agent (derives
 * teacher_id from the agent's row) and admin/superadmin (see all).
 *
 * Uses a two-step query (fetch subject IDs first, then filter orders)
 * to avoid nested-join filtering issues with Supabase JS client.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (!role || !['teacher', 'admin', 'superadmin', 'registration_agent'].includes(role)) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  // 1. Determine the teacher_id filter.
  let teacherIdFilter: string | null = null;
  if (role === 'teacher') {
    teacherIdFilter = auth.user.id;
  } else if (role === 'registration_agent') {
    const { data: agent } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();
    teacherIdFilter = (agent as { teacher_id: string } | null)?.teacher_id ?? null;
    if (!teacherIdFilter) {
      return NextResponse.json({ success: false, error: 'تعذر تحديد المعلم المرتبط بك' }, { status: 403 });
    }
  }
  // admin/superadmin: teacherIdFilter stays null → sees all.

  // 2. Fetch the teacher's subject IDs (if filtered).
  let subjectIds: string[] | null = null;
  if (teacherIdFilter) {
    const { data: subjects, error: subErr } = await supabaseServer
      .from('subjects')
      .select('id')
      .eq('teacher_id', teacherIdFilter);
    if (subErr) {
      return NextResponse.json({ success: false, error: 'فشل تحميل مقررات المعلم' }, { status: 500 });
    }
    subjectIds = ((subjects ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (subjectIds.length === 0) {
      return NextResponse.json({ success: true, orders: [] });
    }
  }

  // 3. Query orders (without nested join filter — use .in() instead).
  let query = supabaseServer
    .from('orders')
    .select(
      'id, student_id, subject_id, amount, currency, status, confirmation_mode, created_at, ' +
      'subject:subjects(id, name, level, sub_level), ' +
      'student:users!student_id(id, email, name, student_code)'
    )
    .eq('status', 'pending')
    .eq('confirmation_mode', 'manual')
    .order('created_at', { ascending: false })
    .limit(200);

  if (subjectIds) {
    query = query.in('subject_id', subjectIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[teacher/pending-orders] query error:', error);
    return NextResponse.json({ success: false, error: 'فشل تحميل الطلبات المعلقة' }, { status: 500 });
  }

  return NextResponse.json({ success: true, orders: data ?? [] });
}
