import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { calculateFees, breakdownToJsonb } from '@/lib/fees/calculator';

/**
 * POST /api/student/orders
 *
 * Body: { subjectIds: string[] (UUID array — multi-course),
 *          planId?: string (UUID — optional subscription plan) }
 *
 * If planId is provided, the order uses the plan's price + duration
 * instead of the default subject.price. The plan must be active and
 * belong to one of the specified subjects.
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
  // v113: optional subscription plan ID (monthly/term/yearly) — used when
  // the student subscribes to ONE subject with a specific plan.
  planId: z.string().uuid().optional(),
  // v116: per-subject plan assignments — used when the student subscribes
  // to MULTIPLE subjects at once, each with its own selected plan.
  // Format: { "subjectId1": "planId1", "subjectId2": "planId2", ... }
  // The API validates each planId belongs to the specified subjectId.
  planIds: z.record(z.string().uuid(), z.string().uuid()).optional(),
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
  const planId = parsed.data.planId;
  const planIdsMap = parsed.data.planIds ?? {};

  // v116: fetch ALL plans referenced in either planId (single) or planIds
  // (per-subject map) in ONE query. This replaces the old single-planId-only
  // fetch + allows the activation page to send per-subject plan assignments
  // when the student subscribes to multiple subjects at once (each with its
  // own plan — e.g., subject A with yearly plan, subject B with free plan).
  const allPlanIdsToFetch = new Set<string>();
  if (planId) allPlanIdsToFetch.add(planId);
  for (const pid of Object.values(planIdsMap)) allPlanIdsToFetch.add(pid);

  // Map: subjectId → plan details (price, duration, etc.)
  const plansBySubjectId = new Map<string, {
    id: string; price: number; duration_days: number;
    period_type: string; period_label: string;
  }>();

  if (allPlanIdsToFetch.size > 0) {
    const { data: plansData, error: plansErr } = await supabaseServer
      .from('subject_subscription_plans')
      .select('id, subject_id, period_type, period_label, duration_days, price, is_active')
      .in('id', Array.from(allPlanIdsToFetch));

    if (plansErr || !plansData) {
      return NextResponse.json(
        { success: false, error: 'تعذّر جلب بيانات خطط الاشتراك' },
        { status: 500 },
      );
    }

    for (const p of plansData as Array<{ id: string; subject_id: string; period_type: string; period_label: string; duration_days: number; price: number; is_active: boolean }>) {
      if (!p.is_active) continue;
      if (!requestedSubjectIds.includes(p.subject_id)) continue;
      plansBySubjectId.set(p.subject_id, {
        id: p.id,
        price: Number(p.price),
        duration_days: p.duration_days,
        period_type: p.period_type,
        period_label: p.period_label,
      });
    }
  }

  // Legacy single-planId support: if planId is provided, use it for ALL
  // subjects (backward compat with old callers that send a single planId).
  // But only if the plan's subject is in the requested list.
  let planPriceOverride: number | null = null;
  let planDurationDays: number | null = null;
  let planPeriodType: string | null = null;
  let planPeriodLabel: string | null = null;
  let legacyPlanId: string | null = null;
  if (planId) {
    for (const [sid, p] of plansBySubjectId.entries()) {
      if (p.id === planId) {
        legacyPlanId = planId;
        planPriceOverride = p.price;
        planDurationDays = p.duration_days;
        planPeriodType = p.period_type;
        planPeriodLabel = p.period_label;
        break;
      }
    }
    if (!legacyPlanId) {
      return NextResponse.json(
        { success: false, error: 'خطة الاشتراك غير موجودة أو غير مفعّلة أو لا تنتمي لأحد المقررات المطلوبة' },
        { status: 400 },
      );
    }
  }

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

  // v92+ — track which requested subjects were NOT available (paused or
  // subscription closed) so the UI can show a meaningful message instead
  // of silently returning success:true with no created/skipped orders.
  const notAvailableSubjects: Array<{ subject_id: string; reason: string }> = [];
  for (const sid of requestedSubjectIds) {
    if (!subjectsMap.has(sid)) {
      const raw = ((subjectsData ?? []) as Array<{ id: string; is_paused: boolean; subscription_open: boolean }>).find((s) => s.id === sid);
      notAvailableSubjects.push({
        subject_id: sid,
        reason: raw?.is_paused ? 'المقرر متوقف مؤقتاً' : 'الاشتراك مغلق لهذا المقرر',
      });
    }
  }

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
  //    v88+ — return the existing order IDs so the UI can open the
  //    payment dialog on them (instead of silently skipping + showing
  //    a misleading "order created" toast).
  const { data: existingOrders } = await supabaseServer
    .from('orders')
    .select('id, subject_id, amount, base_amount, fees_total, grand_total, currency')
    .eq('student_id', studentId)
    .in('subject_id', requestedSubjectIds)
    .eq('status', 'pending');

  // Map: subject_id → existing pending order (full row)
  const existingBySubject = new Map<string, { id: string; amount: number; base_amount: number | null; fees_total: number | null; grand_total: number | null; currency: string }>(
    ((existingOrders ?? []) as Array<{ id: string; subject_id: string; amount: number; base_amount: number | null; fees_total: number | null; grand_total: number | null; currency: string }>)
      .map((o) => [o.subject_id, o])
  );

  // 4. Create new orders.
  //    - FREE courses (price=0): create 'pending' order then immediately
  //      call the RPC to activate (no payment gateway needed for free).
  //    - PAID courses (price>0): create 'pending' order. Activation will
  //      happen ONLY when the payment gateway calls /api/payment/webhook
  //      after a real successful payment. Until then, the order stays
  //      'pending' and the student sees it in their pending list.
  const createdOrders: Array<Record<string, unknown>> = [];
  const skippedOrders: Array<{ subject_id: string; order_id: string; amount: number; base_amount: number | null; fees_total: number | null; grand_total: number | null; currency: string }> = [];
  for (const subjectId of requestedSubjectIds) {
    if (existingBySubject.has(subjectId)) {
      // v88+ — include the existing order's full data so the UI can
      // open the payment dialog on it (with fees breakdown) instead
      // of silently skipping + showing a misleading success toast.
      const existing = existingBySubject.get(subjectId)!;
      skippedOrders.push({
        subject_id: subjectId,
        order_id: existing.id,
        amount: Number(existing.amount),
        base_amount: existing.base_amount,
        fees_total: existing.fees_total,
        grand_total: existing.grand_total,
        currency: existing.currency,
      });
      continue;
    }
    const subject = subjectsMap.get(subjectId);
    if (!subject) continue;

    // v116: resolve the per-subject plan (from planIds map) OR fall back
    // to the legacy single planId (applied to all subjects). This ensures
    // each subject uses its own selected plan — critical for multi-subject
    // subscriptions where subject A might have a free plan and subject B
    // might have a yearly plan.
    const subjectPlan = plansBySubjectId.get(subjectId);
    const effectivePlanId = subjectPlan?.id ?? legacyPlanId ?? null;
    const effectivePriceOverride = subjectPlan?.price ?? planPriceOverride ?? null;
    const effectiveDurationDays = subjectPlan?.duration_days ?? planDurationDays ?? null;
    const effectivePeriodType = subjectPlan?.period_type ?? planPeriodType ?? null;
    const effectivePeriodLabel = subjectPlan?.period_label ?? planPeriodLabel ?? null;

    if (subject.price === 0) {
      // v113: FREE course — create 'pending' order, do NOT auto-activate.
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
          plan_id: effectivePlanId,
          plan_duration_days: effectiveDurationDays,
        })
        .select('id')
        .single();

      if (freeOrder) {
        createdOrders.push({ subject_id: subjectId, subject_name: subject.name, amount: 0, status: 'pending', free: true, order_id: (freeOrder as { id: string }).id });
      }
    } else if (effectivePriceOverride === 0) {
      // v116: PAID subject + FREE plan (e.g., scholarship plan with price=0).
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
          plan_id: effectivePlanId,
          plan_duration_days: effectiveDurationDays,
        })
        .select('id')
        .single();

      if (freeOrder) {
        createdOrders.push({
          subject_id: subjectId,
          subject_name: subject.name,
          amount: 0,
          status: 'pending',
          free: true,
          free_plan: true,
          plan_period_type: effectivePeriodType,
          plan_period_label: effectivePeriodLabel,
          order_id: (freeOrder as { id: string }).id,
        });
      }
    } else {
      // PAID course — create 'pending' order. The order will be
      // activated later ONLY via /api/payment/webhook (called by
      // Paymob after a real successful payment). There is NO manual
      // approval path, NO proof submission, NO admin bypass.
      //
      // v88 — fees-on-top model: fetch active fees from fee_catalog,
      // compute the breakdown, and store the snapshot in order_fees.
      // The order's `amount` field stays equal to `grand_total`
      // (= base_amount + fees_total) for backward compatibility with
      // the existing webhook/RPC code that uses `orders.amount`. The
      // new `base_amount`, `fees_total`, `grand_total` columns are
      // the structured source of truth going forward.
      //
      // v112 — per-teacher commission override:
      //   1. Read the subject's teacher_id (already in scope).
      //   2. Read users.commission_rate for that teacher.
      //   3. If NOT NULL → override the platform_commission fee's
      //      value with the teacher's rate.
      //   4. If NULL → keep the global fee_catalog value unchanged.
      //   5. If the teacher cannot be resolved → preserve the existing
      //      global behavior (do not invent a rate).
      //   6. calculateFees() then runs normally; the resulting
      //      calculated_amount is snapshotted into order_fees.
      //   7. NO existing order or order_fees row is modified — this
      //      flow only applies to NEW orders being created right now.
      const { data: activeFees } = await supabaseServer
        .from('fee_catalog')
        .select('id, code, name_ar, name_en, fee_kind, value, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      // Look up the teacher's per-teacher commission_rate override.
      // subject.teacher_id is already in scope from the subjectsMap.
      let teacherCommissionRate: number | null = null;
      try {
        const { data: teacherRow } = await supabaseServer
          .from('users')
          .select('commission_rate')
          .eq('id', subject.teacher_id)
          .maybeSingle();
        teacherCommissionRate = (teacherRow as { commission_rate: number | null } | null)
          ?.commission_rate ?? null;
      } catch (err) {
        // If the lookup fails, preserve the existing global behavior
        // (do not invent a rate). Log loudly.
        console.error('[student/orders] teacher commission_rate lookup failed', {
          teacherId: subject.teacher_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // v116: use per-subject plan price override when available
      const basePrice = effectivePriceOverride !== null ? effectivePriceOverride : Number(subject.price);
      const feeRows = (activeFees ?? []) as Array<{
        id: string; code: string; name_ar: string; name_en: string;
        fee_kind: 'percentage' | 'flat'; value: number; sort_order: number;
      }>;

      // Apply per-teacher override IN-PLACE on the in-memory feeRows
      // (the DB fee_catalog row is NOT modified — we only override the
      // value used for THIS order's snapshot).
      if (teacherCommissionRate !== null && teacherCommissionRate !== undefined) {
        const platformCommissionFee = feeRows.find((f) => f.code === 'platform_commission');
        if (platformCommissionFee && platformCommissionFee.fee_kind === 'percentage') {
          platformCommissionFee.value = teacherCommissionRate;
        }
      }

      const breakdown = calculateFees(basePrice, feeRows);

      const { data: order, error: insertError } = await supabaseServer
        .from('orders')
        .insert({
          student_id: studentId,
          subject_id: subjectId,
          amount: breakdown.grand_total,
          base_amount: breakdown.base_total,
          fees_total: breakdown.fees_total,
          grand_total: breakdown.grand_total,
          fees_breakdown: breakdownToJsonb(breakdown),
          currency: subject.currency,
          provider: 'pending_gateway',
          provider_order_ref: `order_${randomUUID()}`,
          status: 'pending',
          // v116: snapshot plan_id + plan_duration_days so the activation
          // RPC can use the plan's actual duration (e.g., 365 for yearly)
          // instead of the hardcoded 30-day default.
          plan_id: effectivePlanId,
          plan_duration_days: effectiveDurationDays,
        })
        .select('id, subject_id, amount, base_amount, fees_total, grand_total, currency, provider, status, created_at, fees_breakdown')
        .single();

      if (insertError || !order) {
        // v92+ — DON'T silently skip. Log the error AND add to
        // not_available so the UI shows a meaningful message.
        console.error('[student/orders] order INSERT failed:', insertError?.message, {
          subjectId, studentId, amount: breakdown.grand_total,
        });
        notAvailableSubjects.push({
          subject_id: subjectId,
          reason: `تعذّر إنشاء الطلب: ${insertError?.message ?? 'خطأ غير معروف'}`,
        });
        continue;
      }

      {
        const orderId = (order as { id: string }).id;
        // Snapshot each fee into order_fees (immutable)
        if (breakdown.fees.length > 0) {
          const orderFeesRows = breakdown.fees.map((f) => ({
            order_id: orderId,
            fee_catalog_id: f.id,
            code: f.code,
            name_ar: f.name_ar,
            name_en: f.name_en,
            fee_kind: f.fee_kind,
            value: f.value,
            base_amount: f.base_amount,
            calculated_amount: f.calculated_amount,
            sort_order: f.sort_order,
          }));
          const { error: ofErr } = await supabaseServer
            .from('order_fees')
            .insert(orderFeesRows);
          if (ofErr) {
            console.error('[student/orders] order_fees insert failed:', ofErr.message);
            // Don't fail the order creation — the order row is already
            // created and the snapshot can be backfilled later. But log
            // loudly so the operator can investigate.
          }
        }

        createdOrders.push({
          ...(order as Record<string, unknown>),
          subject_name: subject.name,
          fees_breakdown: breakdownToJsonb(breakdown),
          // v113: include plan info in the response so the UI can display it
          ...(planPeriodType ? { plan_period_type: planPeriodType, plan_period_label: planPeriodLabel } : {}),
        });
      }
    }
  }

  // Build a clearer message based on the outcome.
  // v116 — distinguish free-plan reservations so the student understands
  // the order is now in pending state and they cannot re-book the same
  // plan while it's pending.
  let message: string;
  if (createdOrders.length === 0 && skippedOrders.length > 0) {
    // All were skipped — student already has pending orders for these subjects.
    const isAllFree = skippedOrders.every(o => o.amount === 0);
    message = isAllFree
      ? 'لديك طلبات معلّقة بالفعل لهذه المقررات — تم حجزها بانتظار تفعيل الوكيل/المعلم. لا يمكنك إعادة الحجز حتى يتم التفعيل أو الإلغاء.'
      : 'لديك طلبات قيد الدفع بالفعل — يمكنك إتمام الدفع الآن أو إلغاؤها لإعادة المحاولة.';
  } else if (createdOrders.some(o => (o as { free?: boolean }).free)) {
    message = 'تم حجز الطلبات المجانية بنجاح — في انتظار تفعيل الوكيل/المعلم. لا يمكنك إعادة الحجز حتى يتم التفعيل أو الإلغاء.';
  } else if (createdOrders.some(o => o.status === 'pending')) {
    message = 'تم إنشاء الطلبات. سيتم تفعيل المقررات بعد موافقة الوكيل/المعلم أو بعد إتمام الدفع.';
  } else {
    message = 'تم إنشاء الطلبات بنجاح.';
  }

  return NextResponse.json({
    success: true,
    created_orders: createdOrders,
    // v88+ — skipped now includes the existing order's full data
    skipped: skippedOrders.map((s) => s.subject_id),
    skipped_orders: skippedOrders,
    // v92+ — subjects that were not available (paused or subscription closed)
    not_available: notAvailableSubjects,
    message,
  });
}
