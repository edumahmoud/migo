import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/orders
 *
 * Returns all pending orders for the calling agent's teacher.
 * (Agents can't call /api/teacher/orders because requireTeacher
 * rejects the registration_agent role — this is the agent-side
 * equivalent that uses requireAgent.)
 *
 * Returns orders where:
 *   - status = 'pending'
 *   - subject.teacher_id = agent's teacher_id
 *
 * The response mirrors the shape of /api/teacher/orders so the
 * agent portal can use the same PendingOrder type.
 */

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  base_amount: number | null;
  fees_total: number | null;
  grand_total: number | null;
  fees_breakdown: Array<{ code: string; name_ar: string; name_en: string; fee_kind: string; value: number; base_amount: number; calculated_amount: number }> | null;
  plan_id?: string | null;
  plan_duration_days?: number | null;
  checkout_session_id?: string | null;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  created_at: string;
  subjects: { id: string; name: string; teacher_id: string; price: number | null } | null;
  users: { id: string; name: string | null; email: string; student_code: string | null } | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const teacherId = auth.sourceTeacherId;

  // Fetch all pending orders, then filter to those whose subject
  // belongs to this agent's teacher.
  // v117: include base_amount + fees_total + grand_total + fees_breakdown
  // so the agent UI can show the full payment breakdown (was missing —
  // the agent only saw `amount` which is the grand total, with no way
  // to see commission/tax/other fees breakdown).
  const { data: orders, error: ordersErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      base_amount, fees_total, grand_total, fees_breakdown,
      provider_order_ref, checkout_session_id, created_at,
      plan_id, plan_duration_days,
      subjects:subject_id ( id, name, teacher_id, price ),
      users:student_id ( id, name, email, student_code )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);

  if (ordersErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب الطلبات' },
      { status: 500 },
    );
  }

  const allOrders = (orders ?? []) as unknown as OrderRow[];
  const teacherOrders = allOrders.filter(
    (o) => o.subjects?.teacher_id === teacherId,
  );

  return NextResponse.json({
    success: true,
    orders: teacherOrders.map((o) => ({
      id: o.id,
      student_id: o.student_id,
      subject_id: o.subject_id,
      amount: o.amount,
      // v117: expose the v88 fees-on-top breakdown fields
      base_amount: o.base_amount !== null && o.base_amount !== undefined ? Number(o.base_amount) : null,
      fees_total: o.fees_total !== null && o.fees_total !== undefined ? Number(o.fees_total) : null,
      grand_total: o.grand_total !== null && o.grand_total !== undefined ? Number(o.grand_total) : null,
      fees_breakdown: o.fees_breakdown ?? [],
      // v126: expose plan_duration_days for free plan duration display
      plan_duration_days: o.plan_duration_days ?? null,
      checkout_session_id: o.checkout_session_id ?? null,
      currency: o.currency,
      status: o.status,
      provider_order_ref: o.provider_order_ref,
      created_at: o.created_at,
      student: o.users
        ? {
            id: o.users.id,
            name: o.users.name,
            email: o.users.email,
            student_code: o.users.student_code,
          }
        : null,
      subject: o.subjects
        ? {
            id: o.subjects.id,
            name: o.subjects.name,
            price: o.subjects.price ?? undefined,
          }
        : null,
    })),
  });
}
