import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/pending-orders
 *
 * Lists all PENDING manual-confirmation orders for the requesting
 * teacher's courses. Also accessible by registration_agent (derives
 * teacher_id from the agent's row) and admin/superadmin (see all).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (!role || !['teacher', 'admin', 'superadmin', 'registration_agent'].includes(role)) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

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

  let query = supabaseServer
    .from('orders')
    .select(
      'id, student_id, subject_id, amount, currency, status, confirmation_mode, created_at, ' +
      'subject:subjects!inner(id, name, teacher_id, level, sub_level), ' +
      'student:users!student_id(id, email, name, student_code)'
    )
    .eq('status', 'pending')
    .eq('confirmation_mode', 'manual')
    .order('created_at', { ascending: false })
    .limit(200);

  if (teacherIdFilter) {
    query = query.eq('subject.teacher_id', teacherIdFilter);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل تحميل الطلبات المعلقة' }, { status: 500 });
  }
  return NextResponse.json({ success: true, orders: data ?? [] });
}
