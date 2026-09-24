import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/teacher/pending-orders/[id]/approve
 * Approves a pending manual order → calls activate_subscription_after_payment() RPC.
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const { id } = await ctx.params;

  const { data: order } = await supabaseServer
    .from('orders')
    .select('id, student_id, amount, currency, status, subject:subjects!inner(teacher_id)')
    .eq('id', id).maybeSingle();

  if (!order) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });

  const o = order as unknown as { id: string; student_id: string; amount: number; currency: string; status: string; subject: { teacher_id: string } };
  if (o.subject.teacher_id !== auth.user.id && auth.role !== 'admin' && auth.role !== 'superadmin')
    return NextResponse.json({ success: false, error: 'لا تملك صلاحية' }, { status: 403 });
  if (o.status !== 'pending')
    return NextResponse.json({ success: false, error: `حالة الطلب: ${o.status}` }, { status: 400 });

  const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc('activate_subscription_after_payment', {
    p_order_id: o.id,
    p_provider_payment_id: `manual_${randomUUID()}`,
    p_amount: Number(o.amount),
    p_currency: o.currency,
    p_status: 'paid',
    p_raw_payload: { manual_approval: true, approved_by: auth.user.id, approved_at: new Date().toISOString() },
    p_confirmed_by: auth.user.id,
  });

  if (rpcErr) return NextResponse.json({ success: false, error: 'فشل التفعيل: ' + rpcErr.message }, { status: 500 });

  const result = (rpcResult as { success?: boolean; error?: string }) ?? {};
  if (result.success === false) return NextResponse.json({ success: false, error: result.error }, { status: 400 });

  return NextResponse.json({ success: true, message: 'تم تفعيل الاشتراك بنجاح' });
}
