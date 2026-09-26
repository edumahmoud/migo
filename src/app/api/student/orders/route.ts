import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/orders
 *
 * Body: { subjectIds: string[] (UUID array — multi-course) }
 *
 * Creates one order per selected course.
 *
 * Two paths:
 *   - FREE course (price=0): creates a 'pending' order then immediately
 *     calls activate_subscription_after_payment RPC → marks 'paid' +
 *     creates enrollment + activates student. No payment gateway needed.
 *   - PAID course (price>0): creates a 'pending' order. Activation will
 *     happen later via /api/payment/webhook when the payment gateway
 *     (Paymob) confirms a real payment.
 *
 * The old manual proof-of-payment + supervisor approval + mock gateway
 * paths have been REMOVED. Only the webhook (called by the real payment
 * gateway) can transition a paid order to 'paid' status.
 *
 * Server-side source of truth: student_id from session, price from DB.
 *
 * Response: { success, created_orders, skipped, message }
 */
const BodySchema = z.object({
  subjectIds: z.array(z.string().uuid()).min(1),
});

export async function POST(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'البيانات غير صالحة' }, { status: 400 });
  }

  const studentId = auth.user.id;
  const requestedSubjectIds = Array.from(new Set(parsed.data.subjectIds));

  // 1. Fetch subjects (server-side price source of truth).
  const { data: subjectsData } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id, price, currency, is_paused, subscription_open')
    .in('id', requestedSubjectIds);

  const subjectsMap = new Map<string, { id: string; name: string; teacher_id: string; price: number; currency: string }>(
    ((subjectsData ?? []) as Array<{ id: string; name: string; teacher_id: string; price: number; currency: string; is_paused: boolean; subscription_open: boolean }>)
      .filter((s) => !s.is_paused && s.subscription_open)
      .map((s) => [s.id, { id: s.id, name: s.name, teacher_id: s.teacher_id, price: Number(s.price), currency: s.currency }])
  );

  if (subjectsMap.size === 0) {
    return NextResponse.json({ success: false, error: 'لا توجد مقررات متاحة للاشتراك' }, { status: 400 });
  }

  // 2. Verify teacher links.
  const teacherIds = new Set<string>();
  for (const s of subjectsMap.values()) teacherIds.add(s.teacher_id);

  for (const teacherId of teacherIds) {
    const { data: link } = await supabaseServer
      .from('teacher_student_links')
      .select('id')
      .eq('teacher_id', teacherId)
      .eq('student_id', studentId)
      .eq('status', 'approved')
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ success: false, error: 'يجب ربط حسابك بمعلم هذا المقرر أولاً' }, { status: 403 });
    }
  }

  // 3. Check for existing pending orders (idempotency — don't create duplicates).
  const { data: existingOrders } = await supabaseServer
    .from('orders')
    .select('id, subject_id')
    .eq('student_id', studentId)
    .in('subject_id', requestedSubjectIds)
    .eq('status', 'pending');

  const existingBySubject = new Set<string>(
    ((existingOrders ?? []) as Array<{ subject_id: string }>).map((o) => o.subject_id)
  );

  // 4. Create new orders.
  //    - FREE courses (price=0): create 'pending' order then immediately
  //      call the RPC to activate (no payment gateway needed for free).
  //    - PAID courses (price>0): create 'pending' order. Activation will
  //      happen ONLY when the payment gateway calls /api/payment/webhook
  //      after a real successful payment. Until then, the order stays
  //      'pending' and the student sees it in their pending list.
  const createdOrders: Array<Record<string, unknown>> = [];
  for (const subjectId of requestedSubjectIds) {
    if (existingBySubject.has(subjectId)) continue;
    const subject = subjectsMap.get(subjectId);
    if (!subject) continue;

    if (subject.price === 0) {
      // FREE course — auto-activate immediately via the RPC.
      // (Free courses are NOT considered a "payment system" — they
      //  just need the enrollment to be created.)
      const orderRef = `free_${randomUUID()}`;
      const { data: freeOrder } = await supabaseServer
        .from('orders')
        .insert({
          student_id: studentId,
          subject_id: subjectId,
          amount: 0,
          currency: subject.currency,
          provider: 'free',
          provider_order_ref: orderRef,
          status: 'pending',
        })
        .select('id')
        .single();

      if (freeOrder) {
        const { data: rpcData, error: rpcErr } = await supabaseServer.rpc(
          'activate_subscription_after_payment',
          {
            p_order_id: (freeOrder as { id: string }).id,
            p_provider_payment_id: `free_${randomUUID()}`,
            p_amount: 0,
            p_currency: subject.currency,
            p_status: 'paid',
            p_raw_payload: { free_course: true, auto_activated: true },
            p_confirmed_by: null,
          }
        );

        if (rpcErr) {
          console.error('[student/orders] FREE RPC error:', rpcErr);
          createdOrders.push({ subject_id: subjectId, subject_name: subject.name, amount: 0, status: 'error', free: true, error: rpcErr.message });
        } else {
          const rpcResult = (rpcData as { success?: boolean; error?: string }) ?? {};
          if (rpcResult.success === false) {
            console.error('[student/orders] FREE RPC returned failure:', rpcResult);
            createdOrders.push({ subject_id: subjectId, subject_name: subject.name, amount: 0, status: 'error', free: true, error: rpcResult.error || 'RPC failed' });
          } else {
            createdOrders.push({ subject_id: subjectId, subject_name: subject.name, amount: 0, status: 'paid', free: true });
          }
        }
      }
    } else {
      // PAID course — create 'pending' order. The order will be
      // activated later ONLY via /api/payment/webhook (called by
      // Paymob after a real successful payment). There is NO manual
      // approval path, NO proof submission, NO admin bypass.
      const { data: order } = await supabaseServer
        .from('orders')
        .insert({
          student_id: studentId,
          subject_id: subjectId,
          amount: subject.price,
          currency: subject.currency,
          provider: 'pending_gateway', // will be set to 'paymob' once integrated
          provider_order_ref: `order_${randomUUID()}`,
          status: 'pending',
        })
        .select('id, subject_id, amount, currency, provider, status, created_at')
        .single();

      if (order) {
        createdOrders.push({ ...(order as Record<string, unknown>), subject_name: subject.name });
      }
    }
  }

  return NextResponse.json({
    success: true,
    created_orders: createdOrders,
    skipped: Array.from(existingBySubject),
    message: createdOrders.some(o => o.status === 'pending')
      ? 'تم إنشاء الطلبات. سيتم تفعيل المقررات المدفوعة تلقائياً بعد إتمام الدفع عبر بوابة الدفع.'
      : 'تم تفعيل المقررات المجانية بنجاح.',
  });
}
