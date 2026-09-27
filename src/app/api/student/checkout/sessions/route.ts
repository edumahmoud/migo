import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/checkout/sessions
 *
 * Creates a multi-subject checkout session. Multiple pending paid orders
 * belonging to the calling student are grouped under a single
 * `checkout_session_id`. The student then pays for the whole session in
 * ONE Paymob Intention (via POST /api/student/checkout/sessions/[id]/pay).
 *
 * Flow:
 *   1. Validate the caller is an eligible student.
 *   2. Accept `orderIds: string[]` (1+ order IDs).
 *   3. For each order ID:
 *      - Validate it exists.
 *      - Validate ownership (order.student_id == caller).
 *      - Validate status == 'pending'.
 *      - Validate amount > 0 (no free courses in a checkout session).
 *      - Validate the order is NOT already part of another session
 *        (orders.checkout_session_id IS NULL).
 *   4. Validate all orders share the same currency (we cannot combine
 *      EGP + USD in one Paymob Intention — Paymob expects a single
 *      amount + currency).
 *   5. Compute the total = SUM(orders.amount).
 *   6. Generate `checkout_session_id = randomUUID()`.
 *   7. Update all selected orders: `SET checkout_session_id = ?`.
 *      This is the "smallest compatible backend extension" — no new
 *      table, no constraint weakened. The session_id is a UUID stored
 *      on each member order.
 *   8. Return the session_id + items + total + currency.
 *
 * Idempotency:
 *   - If any of the orderIds is already part of another session, the
 *     request is REJECTED with HTTP 409 — the caller must either pay
 *     the existing session or cancel it first.
 *   - Calling POST /sessions twice with the SAME orderIds returns
 *     different session_ids (no implicit deduplication at this layer).
 *     The UI is responsible for not creating duplicate sessions for
 *     the same set of orders.
 *
 * Security:
 *   - The caller cannot supply a price, currency, or student_id.
 *   - All values are read server-side from the orders table.
 *   - The total amount is computed server-side.
 */
const BodySchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(20),
});

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  checkout_session_id: string | null;
  gateway_id: string | null;
  subjects: { name: string } | null;
}

interface SessionItem {
  order_id: string;
  subject_id: string;
  subject_name: string;
  amount: number;
  currency: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة — orderIds must be a non-empty array of UUIDs' },
      { status: 400 },
    );
  }

  const studentId = auth.user.id;
  const orderIds = Array.from(new Set(parsed.data.orderIds)); // dedup

  // 1. Fetch all requested orders with their subject names.
  const { data: ordersData, error: ordersErr } = await supabaseServer
    .from('orders')
    .select(`
      id, student_id, subject_id, amount, currency, status,
      checkout_session_id, gateway_id,
      subjects:subject_id (name)
    `)
    .in('id', orderIds)
    .eq('student_id', studentId);

  if (ordersErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب الطلبات' },
      { status: 500 },
    );
  }

  const orders = (ordersData ?? []) as unknown as OrderRow[];

  // 2. Validate every requested order was found + belongs to the student.
  if (orders.length !== orderIds.length) {
    const found = new Set(orders.map((o) => o.id));
    const missing = orderIds.filter((id) => !found.has(id));
    return NextResponse.json(
      {
        success: false,
        error: 'بعض الطلبات غير موجودة أو لا تنتمي إلى حسابك',
        missing_order_ids: missing,
      },
      { status: 404 },
    );
  }

  // 3. Validate each order's state.
  for (const o of orders) {
    if (o.status !== 'pending') {
      return NextResponse.json(
        {
          success: false,
          error: `الطلب ${o.id} ليس معلّقًا (حالته: ${o.status}) — لا يمكن دفعه`,
          order_id: o.id,
          status: o.status,
        },
        { status: 400 },
      );
    }
    if (Number(o.amount) <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: `الطلب ${o.id} مجاني — لا يمكن ضمه لجلسة دفع موحدة`,
          order_id: o.id,
        },
        { status: 400 },
      );
    }
    if (o.checkout_session_id) {
      // Order is already part of another session. Reject — the caller
      // must either pay the existing session or cancel it first.
      return NextResponse.json(
        {
          success: false,
          error: `الطلب ${o.id} ضمن جلسة دفع أخرى بالفعل (${o.checkout_session_id})`,
          order_id: o.id,
          existing_session_id: o.checkout_session_id,
          category: 'ALREADY_IN_SESSION',
        },
        { status: 409 },
      );
    }
  }

  // 4. Validate all orders share the same currency (Paymob Intention
  //    requires a single amount + currency).
  const currencies = new Set(orders.map((o) => o.currency));
  if (currencies.size > 1) {
    return NextResponse.json(
      {
        success: false,
        error: 'لا يمكن دمج طلبات بعملات مختلفة في جلسة دفع واحدة',
        currencies: Array.from(currencies),
        category: 'CURRENCY_MISMATCH',
      },
      { status: 400 },
    );
  }
  const currency = orders[0].currency;

  // 5. Compute the total server-side (no client trust).
  const totalAmount = orders.reduce((sum, o) => sum + Number(o.amount), 0);

  // 6. Generate the session_id.
  const sessionId = randomUUID();

  // 7. Update all selected orders with the new session_id.
  //    This is a single UPDATE affecting multiple rows.
  const { error: updateErr } = await supabaseServer
    .from('orders')
    .update({ checkout_session_id: sessionId, updated_at: new Date().toISOString() })
    .in('id', orderIds)
    .eq('student_id', studentId)
    .eq('status', 'pending')            // defense-in-depth — only pending orders
    .is('checkout_session_id', null);   // only orders NOT already in a session

  if (updateErr) {
    // The update may have affected 0 rows if some order was claimed by
    // another session in the meantime (race). Treat that as a conflict.
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر إنشاء جلسة الدفع — قد يكون أحد الطلبات قد ضُمّ لجلسة أخرى. حاول مرة أخرى.',
        category: 'CONCURRENT_SESSION_RACE',
      },
      { status: 409 },
    );
  }

  // 8. Build the response items.
  const items: SessionItem[] = orders.map((o) => ({
    order_id: o.id,
    subject_id: o.subject_id,
    subject_name: o.subjects?.name ?? '—',
    amount: Number(o.amount),
    currency: o.currency,
  }));

  return NextResponse.json({
    success: true,
    session_id: sessionId,
    items,
    total_amount: Number(totalAmount.toFixed(2)),
    currency,
    item_count: items.length,
    message: `تم إنشاء جلسة دفع موحدة لـ ${items.length} مقرر بقيمة ${totalAmount.toFixed(2)} ${currency}. اضغط "ادفع الآن" للمتابعة.`,
  });
}
