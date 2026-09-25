import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/teacher/pending-orders/[id]/reject
 * Accessible by: teacher (owns course), registration_agent (linked to teacher), admin/superadmin.
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (!role || !['teacher', 'admin', 'superadmin', 'registration_agent'].includes(role)) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  const { id: orderId } = await ctx.params;

  // 1. Fetch the order.
  const { data: order } = await supabaseServer
    .from('orders')
    .select('id, status, subject_id')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });

  const o = order as { id: string; status: string; subject_id: string };

  if (o.status !== 'pending') {
    return NextResponse.json({ success: false, error: `حالة الطلب: ${o.status}` }, { status: 400 });
  }

  // 2. Fetch the subject's teacher_id for ownership check.
  const { data: subj } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', o.subject_id)
    .maybeSingle();

  const subjectTeacherId = (subj as { teacher_id: string } | null)?.teacher_id;
  if (!subjectTeacherId) {
    return NextResponse.json({ success: false, error: 'تعذر تحديد معلم المقرر' }, { status: 500 });
  }

  // 3. Authorization check.
  if (role === 'teacher') {
    if (subjectTeacherId !== auth.user.id)
      return NextResponse.json({ success: false, error: 'لا تملك صلاحية' }, { status: 403 });
  } else if (role === 'registration_agent') {
    const { data: agent } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();
    const agentTeacherId = (agent as { teacher_id: string } | null)?.teacher_id;
    if (!agentTeacherId || agentTeacherId !== subjectTeacherId)
      return NextResponse.json({ success: false, error: 'لا تملك صلاحية' }, { status: 403 });
  }

  // 4. Reject the order.
  const { error } = await supabaseServer
    .from('orders')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) return NextResponse.json({ success: false, error: 'فشل رفض الطلب' }, { status: 500 });

  return NextResponse.json({ success: true, message: 'تم رفض الطلب' });
}
