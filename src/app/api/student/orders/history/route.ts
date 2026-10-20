import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/orders/history
 *
 * Returns the calling student's full order history (all statuses) with
 * subject names + prices attached. Uses supabaseServer (service role)
 * to bypass RLS on the subjects table — this fixes the "مقرر غير معروف"
 * bug where students couldn't see subject names via the client-side
 * supabase query (RLS blocks the subjects SELECT for students who
 * don't have an enrollment yet).
 *
 * Response: { success: true, orders: OrderHistory[] }
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const studentId = auth.user.id;

  // 1. Fetch orders (service role bypasses RLS)
  const { data: ordersData, error: ordersError } = await supabaseServer
    .from('orders')
    .select(`
      id, subject_id, amount, currency, status,
      provider_order_ref, checkout_session_id,
      created_at, paid_at, activated_at, plan_duration_days,
      base_amount, fees_total, grand_total
    `)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (ordersError) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب سجل الاشتراكات' },
      { status: 500 },
    );
  }

  if (!ordersData || ordersData.length === 0) {
    return NextResponse.json({ success: true, orders: [] });
  }

  // 2. Fetch subject names SEPARATELY (service role bypasses RLS)
  const subjectIds = Array.from(new Set(
    ordersData.map((o) => o.subject_id).filter(Boolean)
  ));

  let subjectMap: Record<string, { name: string; price: number }> = {};
  if (subjectIds.length > 0) {
    const { data: subjectsData } = await supabaseServer
      .from('subjects')
      .select('id, name, price')
      .in('id', subjectIds);

    for (const s of (subjectsData ?? []) as Array<{ id: string; name: string; price: number }>) {
      subjectMap[s.id] = { name: s.name, price: Number(s.price) };
    }
  }

  // 3. Merge: attach subject to each order
  const orders = ordersData.map((o) => ({
    id: o.id,
    subject_id: o.subject_id,
    amount: Number(o.amount),
    currency: o.currency,
    status: o.status,
    provider_order_ref: o.provider_order_ref,
    checkout_session_id: o.checkout_session_id,
    created_at: o.created_at,
    paid_at: o.paid_at,
    activated_at: o.activated_at,
    plan_duration_days: o.plan_duration_days ?? null,
    base_amount: o.base_amount != null ? Number(o.base_amount) : null,
    fees_total: o.fees_total != null ? Number(o.fees_total) : null,
    grand_total: o.grand_total != null ? Number(o.grand_total) : null,
    subject: subjectMap[o.subject_id]
      ? { id: o.subject_id, name: subjectMap[o.subject_id].name, price: subjectMap[o.subject_id].price }
      : null,
  }));

  return NextResponse.json({ success: true, orders });
}
