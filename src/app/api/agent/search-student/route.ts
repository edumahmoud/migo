import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/search-student
 * Body: { studentCode: string }
 *
 * Searches for a student by their student_code. Returns the student's
 * profile + all their subscriptions (active + expired) for the
 * supervisor's teacher's courses only.
 *
 * The supervisor can view the student's account_status, subscriptions,
 * and current billing periods.
 */
const BodySchema = z.object({ studentCode: z.string().trim().min(1).max(40) });

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'الكود غير صالح' }, { status: 400 });

  const { sourceTeacherId } = auth;

  // 1. Find the student by code.
  const { data: student, error: studentErr } = await supabaseServer
    .from('users')
    .select('id, email, name, username, role, student_code, account_status, created_at')
    .eq('student_code', parsed.data.studentCode.toUpperCase())
    .maybeSingle();

  if (studentErr) return NextResponse.json({ success: false, error: 'تعذّر البحث' }, { status: 500 });
  if (!student) return NextResponse.json({ success: false, error: 'لا يوجد طالب بهذا الكود' }, { status: 404 });

  const s = student as { id: string; email: string; name: string | null; username: string | null; role: string; student_code: string | null; account_status: string | null; created_at: string };

  // 2. Fetch the student's subscriptions for THIS teacher's courses only.
  const { data: subs } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, status, enrollment_method, current_period_start, current_period_end, next_billing_at, monthly_price, enrolled_at, subject:subjects!inner(id, name, level, sub_level, price, is_paused, teacher_id)')
    .eq('student_id', s.id)
    .eq('subject.teacher_id', sourceTeacherId)
    .order('current_period_end', { ascending: false, nullsFirst: false });

  // v132fix: Fetch the latest PAID order for each (student, subject) pair
  // to get the actual subscription plan (plan_duration_days + plan_id).
  // subject_students does NOT store plan_id — the link is implicit via
  // (student_id, subject_id) → orders table. We join with
  // subject_subscription_plans to get period_label + period_type.
  //
  // We fetch ALL paid orders for this student (across the teacher's
  // subjects), then pick the most recent one per subject_id client-side.
  const subjectIds = (subs ?? []).map((su: { subject_id: string }) => su.subject_id);
  let planBySubjectId: Record<string, { plan_duration_days: number | null; period_label: string | null; period_type: string | null }> = {};

  if (subjectIds.length > 0) {
    const { data: paidOrders } = await supabaseServer
      .from('orders')
      .select('id, subject_id, plan_id, plan_duration_days, created_at')
      .eq('student_id', s.id)
      .in('subject_id', subjectIds)
      .eq('status', 'paid')
      .order('created_at', { ascending: false });

    // Collect unique plan_ids to batch-fetch plan labels.
    const planIds = Array.from(new Set(
      (paidOrders ?? [])
        .map((o: { plan_id: string | null }) => o.plan_id)
        .filter((id): id is string => !!id)
    ));

    let planLabelById: Record<string, { period_label: string; period_type: string }> = {};
    if (planIds.length > 0) {
      const { data: plans } = await supabaseServer
        .from('subject_subscription_plans')
        .select('id, period_label, period_type')
        .in('id', planIds);
      for (const p of (plans ?? []) as Array<{ id: string; period_label: string; period_type: string }>) {
        planLabelById[p.id] = { period_label: p.period_label, period_type: p.period_type };
      }
    }

    // Build: subject_id → most recent paid order's plan info.
    // paidOrders is already sorted by created_at DESC, so the first
    // occurrence per subject_id is the most recent.
    const seenSubjects = new Set<string>();
    for (const o of (paidOrders ?? []) as Array<{ id: string; subject_id: string; plan_id: string | null; plan_duration_days: number | null; created_at: string }>) {
      if (seenSubjects.has(o.subject_id)) continue;
      seenSubjects.add(o.subject_id);
      const planInfo = o.plan_id ? planLabelById[o.plan_id] : null;
      planBySubjectId[o.subject_id] = {
        plan_duration_days: o.plan_duration_days,
        period_label: planInfo?.period_label ?? null,
        period_type: planInfo?.period_type ?? null,
      };
    }
  }

  // Enrich each subscription with its plan info.
  const enrichedSubs = (subs ?? []).map((su: Record<string, unknown>) => {
    const subjId = su.subject_id as string;
    const plan = planBySubjectId[subjId];
    return {
      ...su,
      plan_duration_days: plan?.plan_duration_days ?? null,
      period_label: plan?.period_label ?? null,
      period_type: plan?.period_type ?? null,
    };
  });

  // 3. Fetch pending orders for this student (for this teacher's courses).
  //    Include provider_order_ref so the agent can see if the student
  //    already paid on Paymob (provider_order_ref is numeric when Paymob
  //    created an order).
  const { data: orders } = await supabaseServer
    .from('orders')
    .select('id, subject_id, amount, currency, status, created_at, provider_order_ref, subject:subjects!inner(id, name, teacher_id)')
    .eq('student_id', s.id)
    .eq('subject.teacher_id', sourceTeacherId)
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    success: true,
    student: {
      id: s.id, email: s.email, name: s.name, username: s.username,
      student_code: s.student_code, account_status: s.account_status,
      created_at: s.created_at,
    },
    subscriptions: enrichedSubs,
    pending_orders: (orders ?? []).filter((o: { status: string }) => o.status === 'pending'),
  });
}
