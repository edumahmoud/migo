import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/teacher/pending-orders/[id]/reject
 * Rejects a pending order → marks as 'failed'.
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const { id } = await ctx.params;

  const { data: order } = await supabaseServer
    .from('orders')
    .select('id, status, subject:subjects!inner(teacher_id)')
    .eq('id', id).maybeSingle();

  if (!order) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });

  const o = order as unknown as { id: string; status: string; subject: { teacher_id: string } };
  if (o.subject.teacher_id !== auth.user.id && auth.role !== 'admin' && auth.role !== 'superadmin')
    return NextResponse.json({ success: false, error: 'لا تملك صلاحية' }, { status: 403 });
  if (o.status !== 'pending')
    return NextResponse.json({ success: false, error: `حالة الطلب: ${o.status}` }, { status: 400 });

  const { error } = await supabaseServer
    .from('orders')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ success: false, error: 'فشل رفض الطلب' }, { status: 500 });

  return NextResponse.json({ success: true, message: 'تم رفض الطلب' });
}
