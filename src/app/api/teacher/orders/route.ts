import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/orders
 *
 * Returns all pending orders for the calling teacher's subjects.
 * Used by the teacher's "Pending Orders" sidebar section.
 *
 * Returns orders where:
 *   - status = 'pending'
 *   - subject.teacher_id = caller's user ID
 *
 * The response includes:
 *   - order id, amount, currency, created_at
 *   - subject name + id
 *   - student name, email, student_code
 *
 * Authorization:
 *   - Caller must be a teacher/admin/superadmin
 *   - RLS doesn't allow teachers to read orders directly, so this
 *     uses supabaseServer (service role) + filters by subject.teacher_id
 */

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  base_amount?: number | null;
  fees_total?: number | null;
  grand_total?: number | null;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  checkout_session_id: string | null;
  created_at: string;
  plan_id?: string | null;
  plan_duration_days?: number | null;
  subjects: { id: string; name: string; teacher_id: string } | null;
  users: { id: string; name: string | null; email: string; student_code: string | null } | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const teacherId = auth.user.id;

  // Fetch all pending orders for this teacher's subjects
  // Use a join via supabase's nested select syntax
  const { data: orders, error: ordersErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      base_amount, fees_total, grand_total,
      provider_order_ref, checkout_session_id, created_at,
      plan_id, plan_duration_days,
      subjects:subject_id ( id, name, teacher_id ),
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

  // Filter to only orders whose subject belongs to this teacher
  // (the supabase query can't filter on nested fields, so we do it here)
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
      amount: Number(o.amount),
      // v126: expose v88 + plan fields
      base_amount: o.base_amount !== null && o.base_amount !== undefined ? Number(o.base_amount) : null,
      fees_total: o.fees_total !== null && o.fees_total !== undefined ? Number(o.fees_total) : null,
      grand_total: o.grand_total !== null && o.grand_total !== undefined ? Number(o.grand_total) : null,
      plan_duration_days: o.plan_duration_days ?? null,
      currency: o.currency,
      status: o.status,
      provider_order_ref: o.provider_order_ref,
      checkout_session_id: o.checkout_session_id,
      created_at: o.created_at,
      subject: o.subjects
        ? { id: o.subjects.id, name: o.subjects.name }
        : null,
      student: o.users
        ? {
            id: o.users.id,
            name: o.users.name,
            email: o.users.email,
            student_code: o.users.student_code,
          }
        : null,
    })),
    count: teacherOrders.length,
  });
}
