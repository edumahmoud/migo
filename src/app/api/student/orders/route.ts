import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requirePendingStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/orders
 *
 * Body: {
 *   subjectId: string (UUID),
 *   paymentMethodId?: string (UUID, optional — for manual-payment methods like Fawry),
 *   provider?: string (default 'mock' — used for the gateway_order_ref namespace)
 * }
 *
 * Server-side source of truth (client NEVER sends price/amount):
 *   1. Auth → student_id (from session, not body).
 *   2. Fetch subject → verify exists, subscription_open=true, is_paused=false.
 *   3. Verify the student is linked to the subject's teacher (teacher_student_links.status='approved').
 *   4. Fetch REAL price + currency from subjects table.
 *   5. Determine confirmation_mode:
 *      - 'automatic' if no paymentMethodId OR paymentMethod.requires_manual_approval=false
 *      - 'manual' if paymentMethodId points to a manual-approval method (Fawry/InstaPay/cash)
 *   6. Create order with status='pending', provider_order_ref='mock_' + uuid.
 *
 * Returns the order + a checkout URL for the mock gateway (automatic mode)
 * OR a payment method snapshot for manual-approval flow.
 */
const BodySchema = z.object({
  subjectId: z.string().uuid(),
  paymentMethodId: z.string().uuid().optional(),
  provider: z.string().trim().min(1).max(40).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requirePendingStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const studentId = auth.user.id;
  const { subjectId, paymentMethodId, provider } = parsed.data;
  const providerName = provider ?? 'mock';

  // 1. Fetch subject (server-side source of truth for price).
  const { data: subject, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id, price, currency, is_paused, subscription_open')
    .eq('id', subjectId)
    .maybeSingle();

  if (subjectErr || !subject) {
    return NextResponse.json({ success: false, error: 'المقرر غير موجود' }, { status: 404 });
  }

  const subjectRow = subject as {
    id: string;
    name: string;
    teacher_id: string;
    price: number;
    currency: string;
    is_paused: boolean;
    subscription_open: boolean;
  };

  if (subjectRow.is_paused || !subjectRow.subscription_open) {
    return NextResponse.json(
      { success: false, error: 'التسجيل في هذا المقرر متوقف حالياً' },
      { status: 400 }
    );
  }

  // 2. Verify student is linked to the subject's teacher (approved link).
  const { data: link } = await supabaseServer
    .from('teacher_student_links')
    .select('id, status')
    .eq('teacher_id', subjectRow.teacher_id)
    .eq('student_id', studentId)
    .eq('status', 'approved')
    .maybeSingle();

  if (!link) {
    return NextResponse.json(
      { success: false, error: 'يجب ربط حسابك بمعلم هذا المقرر أولاً' },
      { status: 403 }
    );
  }

  // 3. Optional: fetch the payment method to determine confirmation_mode.
  let confirmationMode: 'automatic' | 'manual' = 'automatic';
  let paymentMethodSnapshot: { id: string; name: string; account_identifier: string; contact_for_confirmation: string | null } | null = null;

  if (paymentMethodId) {
    // payment_methods RLS allows students to read methods of teachers they're linked to.
    // The service role bypasses RLS; we re-check the link here for safety.
    const { data: pm } = await supabaseServer
      .from('payment_methods')
      .select('id, teacher_id, name, account_identifier, contact_for_confirmation, is_active, requires_manual_approval')
      .eq('id', paymentMethodId)
      .eq('teacher_id', subjectRow.teacher_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!pm) {
      return NextResponse.json(
        { success: false, error: 'وسيلة الدفع غير متاحة لهذا المعلم' },
        { status: 400 }
      );
    }

    const pmRow = pm as {
      id: string;
      name: string;
      account_identifier: string;
      contact_for_confirmation: string | null;
      requires_manual_approval: boolean;
    };

    confirmationMode = pmRow.requires_manual_approval ? 'manual' : 'automatic';
    paymentMethodSnapshot = {
      id: pmRow.id,
      name: pmRow.name,
      account_identifier: pmRow.account_identifier,
      contact_for_confirmation: pmRow.contact_for_confirmation,
    };
  }

  // 4. Idempotency: if there's already a PENDING order for this student+subject,
  //    return it (don't create a new one).
  const { data: existingOrder } = await supabaseServer
    .from('orders')
    .select('id, status, amount, currency, provider, confirmation_mode, payment_method_id, created_at')
    .eq('student_id', studentId)
    .eq('subject_id', subjectId)
    .in('status', ['pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingOrder) {
    return NextResponse.json({
      success: true,
      order: existingOrder,
      payment_method: paymentMethodSnapshot,
      checkout_url: `/api/payment/mock-checkout?order_id=${(existingOrder as { id: string }).id}`,
      message: 'يوجد طلب دفع مفتوح لهذا المقرر بالفعل — يمكنك استكمال الدفع.',
    });
  }

  // 5. Create the order.
  const providerOrderRef = `${providerName}_${randomUUID()}`;
  const amount = Number(subjectRow.price);
  const currency = subjectRow.currency;

  const { data: order, error: orderErr } = await supabaseServer
    .from('orders')
    .insert({
      student_id: studentId,
      subject_id: subjectId,
      amount,
      currency,
      provider: providerName,
      provider_order_ref: providerOrderRef,
      status: 'pending',
      payment_method_id: paymentMethodId ?? null,
      confirmation_mode: confirmationMode,
    })
    .select('id, student_id, subject_id, amount, currency, provider, provider_order_ref, status, confirmation_mode, payment_method_id, created_at')
    .single();

  if (orderErr) {
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء الطلب: ' + orderErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    order,
    payment_method: paymentMethodSnapshot,
    checkout_url: `/api/payment/mock-checkout?order_id=${(order as { id: string }).id}`,
  });
}
