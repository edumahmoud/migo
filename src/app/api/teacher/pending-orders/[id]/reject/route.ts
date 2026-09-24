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

  const { data: order } = await supabaseServer
    .from('orders')
    .select('id, status, subject:subjects!inner(teacher_id)')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });

  const o = order as unknown as { id: string; status: string; subject: { teacher_id: string } };

  if (role === 'teacher') {
    if (o.subject.teacher_id !== auth.user.id)
      return NextResponse.json({ success: false, error: 'لا تملك صلاحية' }, { status: 403 });
  } else if (role === 'registration_agent') {
    const { data: agent } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();
    const agentTeacherId = (agent as { teacher_id: string } | null)?.teacher_id;
    if (!agentTeacherId || agentTeacherId !== o.subject.teacher_id)
      return NextResponse.json({ success: false, error: 'لا تملك صلاحية' }, { status: 403 });
  }

  if (o.status !== 'pending')
    return NextResponse.json({ success: false, error: `حالة الطلب: ${o.status}` }, { status: 400 });

  const { error } = await supabaseServer
    .from('orders')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) return NextResponse.json({ success: false, error: 'فشل رفض الطلب' }, { status: 500 });

  return NextResponse.json({ success: true, message: 'تم رفض الطلب' });
}
