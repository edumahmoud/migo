import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';
import { parsePaymentCode, generatePaymentCode } from '@/lib/payment/utils';

/**
 * GET /api/orders/search?code=SUB-73998EA0
 *
 * Search for an order by its payment code (e.g., "SUB-73998EA0").
 *
 * Returns the order details + student + subject info (filtered by
 * the caller's role):
 *
 *   - Student: can only see their own orders
 *   - Teacher: can see orders for their subjects (subject.teacher_id = caller.id)
 *   - Registration agent: can see orders for their teacher's subjects
 *   - Admin/superadmin: can see all orders
 *
 * The payment code is derived from the first 8 chars of the order UUID
 * (uppercase, prefixed with "SUB-"). This is unique enough for
 * practical search use.
 *
 * SECURITY:
 *   - Caller must be authenticated (any role)
 *   - RLS-equivalent filtering is applied in code:
 *     - Students: orders.student_id = caller.id
 *     - Teachers: subject.teacher_id = caller.id (via JOIN)
 *     - Agents: subject.teacher_id = agent's sourceTeacherId
 *     - Admins: no filter
 *
 * Response (200 OK):
 *   {
 *     success: true,
 *     order: {
 *       id, payment_code, status, amount, currency,
 *       created_at, paid_at, activated_at,
 *       provider_order_ref, checkout_session_id,
 *       subject: { id, name, price, teacher_id },
 *       student: { id, name, email, student_code },
 *     }
 *   }
 *
 * Response (404 Not Found):
 *   { success: false, error: "..." }
 */

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 },
    );
  }

  const callerId = authResult.user.id;
  const role = await getUserRole(callerId);

  if (!role) {
    return NextResponse.json(
      { success: false, error: 'تعذّر تحديد صلاحياتك' },
      { status: 403 },
    );
  }

  // Extract the code from query params
  const code = request.nextUrl.searchParams.get('code')?.trim();
  if (!code) {
    return NextResponse.json(
      { success: false, error: 'مطلوب parameter code (مثال: SUB-73998EA0)' },
      { status: 400 },
    );
  }

  // Parse the code → get the 8-char prefix
  const prefix = parsePaymentCode(code);
  if (!prefix) {
    return NextResponse.json(
      {
        success: false,
        error: 'صيغة الكود غير صالحة — المطلوب SUB- متبوع بـ 8 أحرف (مثال: SUB-73998EA0)',
      },
      { status: 400 },
    );
  }

  // Find the order by UUID prefix (case-insensitive — Postgres ILIKE)
  const { data: orderData, error: orderErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      provider_order_ref, gateway_id, checkout_session_id,
      created_at, updated_at, paid_at, activated_at,
      subject:subject_id ( id, name, price, teacher_id, level, sub_level ),
      student:student_id ( id, name, email, student_code )
    `)
    .ilike('id', `${prefix}%`)
    .maybeSingle();

  if (orderErr) {
    console.error('[orders:search] DB error:', orderErr);
    return NextResponse.json(
      { success: false, error: 'تعذّر البحث في قاعدة البيانات' },
      { status: 500 },
    );
  }

  if (!orderData) {
    return NextResponse.json(
      { success: false, error: `لا يوجد طلب بالكود ${code}` },
      { status: 404 },
    );
  }

  const o = orderData as unknown as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    status: string;
    provider_order_ref: string | null;
    gateway_id: string | null;
    checkout_session_id: string | null;
    created_at: string;
    updated_at: string;
    paid_at: string | null;
    activated_at: string | null;
    subject: { id: string; name: string; price: number; teacher_id: string; level: string | null; sub_level: string | null } | null;
    student: { id: string; name: string | null; email: string; student_code: string | null } | null;
  };

  // ── Authorization filter (RLS-equivalent) ──
  let authorized = false;
  let callerLabel = '';

  if (role === 'admin' || role === 'superadmin') {
    authorized = true;
    callerLabel = 'admin';
  } else if (role === 'student') {
    authorized = (o.student_id === callerId);
    callerLabel = 'student';
  } else if (role === 'teacher') {
    authorized = (o.subject?.teacher_id === callerId);
    callerLabel = 'teacher';
  } else if (role === 'registration_agent') {
    // Look up the agent's source teacher
    const { data: agentRow } = await supabaseServer
      .from('registration_agents')
      .select('id, source_id, teacher_id, source:registration_sources(teacher_id)')
      .eq('user_id', callerId)
      .eq('is_active', true)
      .single();

    if (agentRow) {
      const row = agentRow as unknown as {
        teacher_id: string | null;
        source: { teacher_id: string } | null;
      };
      const sourceTeacherId = row.teacher_id ?? row.source?.teacher_id ?? null;
      authorized = !!sourceTeacherId && o.subject?.teacher_id === sourceTeacherId;
      callerLabel = 'agent';
    }
  }

  if (!authorized) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — هذا الطلب لا ينتمي إليك أو إلى مقرراتك' },
      { status: 403 },
    );
  }

  // Build the response
  const paymentCode = generatePaymentCode(o.id);
  return NextResponse.json({
    success: true,
    caller: callerLabel,
    order: {
      id: o.id,
      payment_code: paymentCode,
      status: o.status,
      status_label: statusLabel(o.status),
      amount: Number(o.amount),
      currency: o.currency,
      created_at: o.created_at,
      updated_at: o.updated_at,
      paid_at: o.paid_at,
      activated_at: o.activated_at,
      provider_order_ref: o.provider_order_ref,
      checkout_session_id: o.checkout_session_id,
      gateway_id: o.gateway_id,
      subject: o.subject
        ? {
            id: o.subject.id,
            name: o.subject.name,
            price: Number(o.subject.price),
            teacher_id: o.subject.teacher_id,
            level: o.subject.level,
            sub_level: o.subject.sub_level,
          }
        : null,
      student: o.student
        ? {
            id: o.student.id,
            name: o.student.name,
            email: o.student.email,
            student_code: o.student.student_code,
          }
        : null,
    },
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case 'paid': return 'مدفوع';
    case 'pending': return 'معلّق';
    case 'cancelled': return 'ملغي';
    case 'failed': return 'فشل';
    case 'refunded': return 'مسترجع';
    default: return status;
  }
}
