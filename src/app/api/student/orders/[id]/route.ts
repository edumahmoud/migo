import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/orders/[id]
 *
 * Returns the order status + payments for the calling student's own order.
 * The order's student_id must match auth.uid() (enforced by RLS + the
 * explicit check below).
 *
 * Used by the activation page to poll payment status (in case the student
 * is paying manually via Fawry/InstaPay and an admin approves later).
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;

  const { data: order, error } = await supabaseServer
    .from('orders')
    .select(
      'id, student_id, subject_id, amount, currency, provider, status, confirmation_mode, payment_method_id, created_at, paid_at, activated_at, ' +
        'subject:subjects!inner(id, name, level, sub_level, teacher_id), ' +
        'payments(id, provider_payment_id, amount, currency, status, created_at, confirmed_by)'
    )
    .eq('id', id)
    .single();

  if (error || !order) {
    return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
  }

  // Ownership check (defense-in-depth on top of RLS).
  if ((order as unknown as { student_id: string }).student_id !== auth.user.id) {
    return NextResponse.json(
      { success: false, error: 'لا تملك صلاحية الوصول لهذا الطلب' },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true, order });
}
