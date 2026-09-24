import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requirePendingStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/orders
 *
 * Body: {
 *   subjectIds: string[] (UUID array — multi-course),
 *   paymentMethodId?: string (UUID — selects a specific payment method)
 * }
 *
 * Creates one order per selected course. Confirmation mode depends
 * on the payment method's requires_manual_approval flag:
 *   - No paymentMethodId → manual (student pays externally, teacher approves)
 *   - paymentMethodId with requires_manual_approval=false → automatic (redirect to gateway)
 *   - paymentMethodId with requires_manual_approval=true → manual
 *
 * Response includes:
 *   - created_orders: array of order objects
 *   - payment_methods: the teacher's active payment methods (for display)
 *   - checkout_url: if any order is automatic mode (for the mock gateway)
 *
 * Server-side source of truth: student_id from session, price from DB.
 */
const BodySchema = z.object({
  subjectIds: z.array(z.string().uuid()).min(1),
  paymentMethodId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requirePendingStudent(request);
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

  // 3. Determine confirmation mode from the payment method (if provided).
  let confirmationMode: 'automatic' | 'manual' = 'manual';
  if (parsed.data.paymentMethodId) {
    const { data: pm } = await supabaseServer
      .from('payment_methods')
      .select('id, teacher_id, requires_manual_approval')
      .in('teacher_id', Array.from(teacherIds))
      .eq('id', parsed.data.paymentMethodId)
      .eq('is_active', true)
      .maybeSingle();
    if (pm) {
      confirmationMode = (pm as { requires_manual_approval: boolean }).requires_manual_approval ? 'manual' : 'automatic';
    }
  }

  // 4. Check for existing pending orders (idempotency).
  const { data: existingOrders } = await supabaseServer
    .from('orders')
    .select('id, subject_id')
    .eq('student_id', studentId)
    .in('subject_id', requestedSubjectIds)
    .eq('status', 'pending');

  const existingBySubject = new Set<string>(
    ((existingOrders ?? []) as Array<{ subject_id: string }>).map((o) => o.subject_id)
  );

  // 5. Create new orders.
  const createdOrders: Array<Record<string, unknown>> = [];
  for (const subjectId of requestedSubjectIds) {
    if (existingBySubject.has(subjectId)) continue;
    const subject = subjectsMap.get(subjectId);
    if (!subject) continue;

    const { data: order } = await supabaseServer
      .from('orders')
      .insert({
        student_id: studentId,
        subject_id: subjectId,
        amount: subject.price,
        currency: subject.currency,
        provider: confirmationMode === 'automatic' ? 'mock' : 'manual',
        provider_order_ref: `${confirmationMode === 'automatic' ? 'mock' : 'manual'}_${randomUUID()}`,
        status: 'pending',
        payment_method_id: parsed.data.paymentMethodId ?? null,
        confirmation_mode: confirmationMode,
      })
      .select('id, subject_id, amount, currency, provider, status, confirmation_mode, created_at')
      .single();

    if (order) {
      createdOrders.push({ ...(order as Record<string, unknown>), subject_name: subject.name });
    }
  }

  // 6. Fetch teacher's active payment methods for display.
  let paymentMethods: Array<Record<string, unknown>> = [];
  if (teacherIds.size > 0) {
    const { data: pms } = await supabaseServer
      .from('payment_methods')
      .select('id, name, icon, account_identifier, contact_for_confirmation, requires_manual_approval')
      .in('teacher_id', Array.from(teacherIds))
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    paymentMethods = (pms ?? []) as Array<Record<string, unknown>>;
  }

  // 7. If automatic mode, provide checkout URL for the first order.
  let checkoutUrl: string | null = null;
  if (confirmationMode === 'automatic' && createdOrders.length > 0) {
    const firstOrder = createdOrders[0] as { id: string };
    if (firstOrder?.id) {
      checkoutUrl = `/api/payment/mock-checkout?order_id=${firstOrder.id}`;
    }
  }

  return NextResponse.json({
    success: true,
    created_orders: createdOrders,
    skipped: Array.from(existingBySubject),
    payment_methods: paymentMethods,
    confirmation_mode: confirmationMode,
    checkout_url: checkoutUrl,
    message: confirmationMode === 'manual'
      ? 'تم إنشاء طلبات الدفع. قم بالتحويل عبر إحدى وسائل الدفع، ثم سيقوم المركز بتفعيل اشتراكك.'
      : 'تم إنشاء الطلبات. سيتم تحويلك لصفحة الدفع.',
  });
}
