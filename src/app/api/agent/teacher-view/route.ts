import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/teacher-view?section=<section_id>
 *
 * v132: Returns data for the agent's top-level sections, scoped to the
 * agent's teacher. The agent may only see the section if it appears
 * in their allowed_sections (or if allowed_sections is NULL = all
 * sections allowed).
 *
 * Sections supported (9 total):
 *   dashboard           → stats (subjects, students, pending orders, active subscriptions)
 *   subjects            → list of subjects with name, level, students count, plans[]
 *   students            → list of students enrolled in the teacher's courses
 *   pendingOrders       → list of pending orders (mirror of /api/agent/orders)
 *   tracking            → per-student performance metrics (attendance, quizzes, assignments, lesson progress)
 *   financialManagement → per-transaction ledger (gross, teacher_share, platform_share)
 *   calendar            → scheduled events (quizzes, assignments, lectures)
 *   reports             → moderation reports (from `reports` table)
 *
 * Authorization: requireAgent (role='registration_agent').
 * Section allow-check: if agent.allowed_sections is non-null and
 * does not contain the requested section → 403.
 */
const SectionSchema = z.enum([
  'dashboard',
  'subjects',
  'students',
  'pendingOrders',
  'tracking',
  'financialManagement',
  'calendar',
  'reports',
]);

export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = new URL(request.url);
  const rawSection = searchParams.get('section') ?? '';
  const parsed = SectionSchema.safeParse(rawSection);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'قسم غير صالح' },
      { status: 400 },
    );
  }
  const section = parsed.data;

  // v116: pagination — the agent's Teacher View must NOT load long
  // lists in one shot. Default limit is 20 items, max 50. The UI
  // shows a "load more" button to fetch the next page.
  const rawLimit = Number(searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 50
    ? Math.floor(rawLimit)
    : 20;
  const rawOffset = Number(searchParams.get('offset') ?? '0');
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0
    ? Math.floor(rawOffset)
    : 0;

  // Per-agent allowed_sections check.
  const allowed = auth.agent.allowed_sections;
  if (allowed !== null && !allowed.includes(section)) {
    return NextResponse.json(
      {
        success: false,
        error: 'المعلم لم يمنحك صلاحية رؤية هذا القسم. تواصل معه للتفعيل.',
      },
      { status: 403 },
    );
  }

  const teacherId = auth.sourceTeacherId;

  try {
    switch (section) {
      case 'dashboard':
        return await handleDashboard(teacherId);
      case 'subjects':
        return await handleSubjects(teacherId, limit, offset);
      case 'students':
        return await handleStudents(teacherId, limit, offset);
      case 'pendingOrders':
        return await handlePendingOrders(teacherId, limit, offset);
      case 'financialManagement':
        // v132 Phase 6: per-transaction financial view (excludes payout methods).
        return await handleFinancial(teacherId, limit, offset);
      case 'tracking':
        // v132 Phase 5: per-student performance metrics.
        return await handleTracking(teacherId, limit, offset);
      case 'calendar':
        // v132 Phase 1: temporary placeholder — full handler in Phase 7.
        return NextResponse.json({
          success: true,
          section,
          items: [],
          note: 'سيتم توفير بيانات التقويم قريباً.',
        });
      case 'reports':
        // v132 Phase 1: temporary placeholder — full handler in Phase 7.
        return NextResponse.json({
          success: true,
          section,
          items: [],
          note: 'سيتم توفير بيانات البلاغات قريباً.',
        });
      default:
        return NextResponse.json({
          success: true,
          section,
          items: [],
          note: 'هذا القسم غير مُفعّل للعرض كمعاينة وكيل.',
        });
    }
  } catch (err) {
    console.error('[GET /api/agent/teacher-view] error:', err);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحميل بيانات القسم' },
      { status: 500 },
    );
  }
}

// ──────────────────────────────────────────────────────────────
// Section handlers
// ──────────────────────────────────────────────────────────────

async function handleDashboard(teacherId: string) {
  // First, fetch the teacher's subject IDs (we need them for order filtering).
  const { data: teacherSubjects } = await supabaseServer
    .from('subjects')
    .select('id')
    .eq('teacher_id', teacherId);
  const teacherSubjectIds = (teacherSubjects ?? []).map((s: { id: string }) => s.id);

  // Count subjects directly (1 query).
  const subjectsCount = teacherSubjectIds.length;

  // Count distinct students enrolled in those subjects + active subscriptions.
  // v132: an "active subscription" = a row in subject_students with
  // status='approved' (one per subject per student). This is the count
  // of currently-active enrollments, NOT distinct students.
  let studentsCount = 0;
  let activeSubscriptions = 0;
  if (teacherSubjectIds.length > 0) {
    const { data: enrollments } = await supabaseServer
      .from('subject_students')
      .select('student_id')
      .in('subject_id', teacherSubjectIds)
      .eq('status', 'approved');
    const rows = (enrollments ?? []) as { student_id: string }[];
    const uniqueIds = new Set(rows.map(r => r.student_id));
    studentsCount = uniqueIds.size;
    activeSubscriptions = rows.length;
  }

  // Count pending orders for the teacher's subjects.
  let pendingCount = 0;
  if (teacherSubjectIds.length > 0) {
    const { count: pc } = await supabaseServer
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .in('subject_id', teacherSubjectIds);
    pendingCount = pc ?? 0;
  }

  // v132: replaced paid_orders with active_subscriptions. The dashboard
  // card now shows "اشتراكات نشطة" (active subscriptions count) instead
  // of "طلبات مدفوعة" (paid orders count). This is more relevant to the
  // agent's day-to-day work.
  return NextResponse.json({
    success: true,
    section: 'dashboard',
    stats: {
      total_subjects: subjectsCount,
      total_students: studentsCount,
      pending_orders: pendingCount,
      active_subscriptions: activeSubscriptions,
    },
  });
}

async function handleSubjects(teacherId: string, limit: number, offset: number) {
  // Count total first so the UI can show "showing X of Y".
  const { count: totalCount } = await supabaseServer
    .from('subjects')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacherId);

  const { data: subjects, error } = await supabaseServer
    .from('subjects')
    .select(`
      id, name, level, sub_level, price, is_paused,
      created_at,
      subject_students_count:subject_students(count)
    `)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  // v132: Fetch active subscription plans for each subject in one query.
  // We'll group them client-side by subject_id. Only is_active=true
  // plans are included (matches what students see at checkout).
  const subjectIds = (subjects ?? []).map((s: { id: string }) => s.id);
  let plansBySubject: Record<string, Array<{
    id: string; period_type: string; period_label: string;
    duration_days: number; price: number; currency: string;
  }>> = {};
  if (subjectIds.length > 0) {
    const { data: plans } = await supabaseServer
      .from('subject_subscription_plans')
      .select('id, subject_id, period_type, period_label, duration_days, price, currency, is_active, sort_order')
      .in('subject_id', subjectIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    for (const p of (plans ?? []) as Array<{
      id: string; subject_id: string; period_type: string; period_label: string;
      duration_days: number; price: number; currency: string;
    }>) {
      if (!plansBySubject[p.subject_id]) plansBySubject[p.subject_id] = [];
      plansBySubject[p.subject_id].push({
        id: p.id,
        period_type: p.period_type,
        period_label: p.period_label,
        duration_days: p.duration_days,
        price: Number(p.price) || 0,
        currency: p.currency,
      });
    }
  }

  const items = (subjects ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    level: s.level as string | null,
    sub_level: s.sub_level as string | null,
    price: s.price as number | null,
    is_paused: s.is_paused as boolean,
    students_count: Array.isArray(s.subject_students_count) ? (s.subject_students_count[0] as { count: number })?.count ?? 0 : 0,
    // v132: active subscription plans (monthly/term/yearly/custom) with
    // their actual prices. The UI shows these instead of a single
    // default monthly price.
    plans: plansBySubject[s.id as string] ?? [],
  }));

  const total = totalCount ?? 0;
  return NextResponse.json({
    success: true,
    section: 'subjects',
    items,
    total_count: total,
    has_more: offset + items.length < total,
    limit,
    offset,
  });
}

async function handleStudents(teacherId: string, limit: number, offset: number) {
  // v130 fix: Count UNIQUE students (not enrollment rows).
  // A student enrolled in 3 courses = 1 student, not 3.
  // Also separate free vs paid enrollments.
  const subjectIds = (await supabaseServer.from('subjects').select('id, price').eq('teacher_id', teacherId)).data ?? [];
  const subjectIdList = subjectIds.map((s: { id: string }) => s.id);
  const freeSubjectIds = subjectIds.filter((s: { price: number | null }) => !s.price || s.price === 0).map((s: { id: string }) => s.id);
  const paidSubjectIds = subjectIds.filter((s: { price: number | null }) => s.price && s.price > 0).map((s: { id: string }) => s.id);

  if (subjectIdList.length === 0) {
    return NextResponse.json({
      success: true,
      section: 'students',
      items: [],
      total_count: 0,
      unique_count: 0,
      free_count: 0,
      paid_count: 0,
      pending_count: 0,
      pending_enrollments: [],
    });
  }

  // Fetch ALL enrollments (approved) to count unique students
  const { data: allEnrollments } = await supabaseServer
    .from('subject_students')
    .select('student_id, subject_id, status, enrolled_at, student:users!student_id(id, name, email, student_code, account_status)')
    .in('subject_id', subjectIdList)
    .order('enrolled_at', { ascending: false });

  type EnrollRow = {
    student_id: string;
    subject_id: string;
    status: string;
    enrolled_at: string | null;
    student: { id: string; name: string | null; email: string; student_code: string | null; account_status: string | null } | null;
  };
  const rows = (allEnrollments ?? []) as unknown as EnrollRow[];

  // Group by student — unique students only
  const byStudent = new Map<string, {
    id: string; name: string | null; email: string; student_code: string | null;
    account_status: string | null;
    enrollments: Array<{ subject_id: string; subject_name: string; status: string; is_free: boolean; enrolled_at: string | null }>;
  }>();

  const subjectNameMap = new Map<string, string>();
  // Fetch subject names
  const { data: subjData } = await supabaseServer.from('subjects').select('id, name').eq('teacher_id', teacherId);
  (subjData ?? []).forEach((s: { id: string; name: string }) => subjectNameMap.set(s.id, s.name));

  const pendingEnrollments: Array<{
    enrollment_id: string; student_id: string; student_name: string | null;
    student_email: string; student_code: string | null;
    subject_id: string; subject_name: string; enrollment_method: string; enrolled_at: string | null;
  }> = [];

  const freeStudentIds = new Set<string>();
  const paidStudentIds = new Set<string>();

  for (const r of rows) {
    if (!r.student) continue;
    const sid = r.student.id;
    const isFree = freeSubjectIds.includes(r.subject_id);

    if (r.status === 'approved') {
      if (isFree) freeStudentIds.add(sid);
      else paidStudentIds.add(sid);
    }

    if (!byStudent.has(sid)) {
      byStudent.set(sid, {
        id: sid,
        name: r.student.name,
        email: r.student.email,
        student_code: r.student.student_code,
        account_status: r.student.account_status,
        enrollments: [],
      });
    }
    byStudent.get(sid)!.enrollments.push({
      subject_id: r.subject_id,
      subject_name: subjectNameMap.get(r.subject_id) ?? '—',
      status: r.status,
      is_free: isFree,
      enrolled_at: r.enrolled_at,
    });

    if (r.status === 'pending') {
      pendingEnrollments.push({
        enrollment_id: r.student_id + r.subject_id,
        student_id: sid,
        student_name: r.student.name,
        student_email: r.student.email,
        student_code: r.student.student_code,
        subject_id: r.subject_id,
        subject_name: subjectNameMap.get(r.subject_id) ?? '—',
        enrollment_method: 'agent_register',
        enrolled_at: r.enrolled_at,
      });
    }
  }

  // Paginate the unique student list
  const allStudents = Array.from(byStudent.values());
  const studentItems = allStudents.slice(offset, offset + limit);

  return NextResponse.json({
    success: true,
    section: 'students',
    items: studentItems,
    total_count: allStudents.length,
    unique_count: allStudents.length,
    free_count: freeStudentIds.size,
    paid_count: paidStudentIds.size,
    pending_count: pendingEnrollments.length,
    pending_enrollments: pendingEnrollments,
    has_more: offset + studentItems.length < allStudents.length,
    limit,
    offset,
  });
}

async function handlePendingOrders(teacherId: string, limit: number, offset: number) {
  const teacherSubjects = await supabaseServer.from('subjects').select('id, name, price').eq('teacher_id', teacherId);
  const teacherSubjectIds = (teacherSubjects.data ?? []).map((s: { id: string }) => s.id);

  if (teacherSubjectIds.length === 0) {
    return NextResponse.json({ success: true, section: 'pendingOrders', items: [], total_count: 0, has_more: false, limit, offset });
  }

  const { count: totalCount } = await supabaseServer
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .in('subject_id', teacherSubjectIds);

  const { data: orders, error } = await supabaseServer
    .from('orders')
    .select(`
      id, amount, currency, status, created_at, provider_order_ref,
      student:users!student_id(id, name, email, student_code),
      subject:subjects(id, name, price)
    `)
    .eq('status', 'pending')
    .in('subject_id', teacherSubjectIds)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const total = totalCount ?? 0;
  return NextResponse.json({
    success: true,
    section: 'pendingOrders',
    items: orders ?? [],
    total_count: total,
    has_more: offset + (orders?.length ?? 0) < total,
    limit,
    offset,
  });
}

async function handleRegistration(teacherId: string, limit: number, offset: number) {
  const { count: totalCount } = await supabaseServer
    .from('registration_agents')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacherId);

  const { data: agents, error } = await supabaseServer
    .from('registration_agents')
    .select('id, display_name, kind, is_active, created_at, user:users!user_id(id, email, name)')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const total = totalCount ?? 0;
  return NextResponse.json({
    success: true,
    section: 'registration',
    items: (agents ?? []).map((a: Record<string, unknown>) => ({
      id: a.id as string,
      display_name: a.display_name as string | null,
      kind: a.kind as string | null,
      is_active: a.is_active as boolean,
      created_at: a.created_at as string,
      user: a.user as { id: string; email: string; name: string | null } | null,
    })),
    total_count: total,
    has_more: offset + (agents?.length ?? 0) < total,
    limit,
    offset,
  });
}

async function handleSummaries(teacherId: string, limit: number, offset: number) {
  const { data: summaries, error } = await supabaseServer
    .from('summaries')
    .select(`
      id, title, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (summaries ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'summaries',
    items: summaries ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleQuestionBank(teacherId: string, limit: number, offset: number) {
  const { data: banks, error } = await supabaseServer
    .from('question_banks')
    .select(`
      id, title, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (banks ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'questionBank',
    items: banks ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleScormLibrary(teacherId: string, limit: number, offset: number) {
  const { data: packages, error } = await supabaseServer
    .from('scorm_packages')
    .select(`
      id, title, status, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (packages ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'scormLibrary',
    items: packages ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleFinancial(teacherId: string, limit: number, offset: number) {
  // v132 Phase 6: expanded from a monthly-aggregate-only view to a full
  // per-transaction view. Returns:
  //   - summary: per-currency aggregates across ALL transactions
  //     (not just the current month) so the numbers match the teacher's
  //     actual lifetime earnings.
  //   - transactions: paginated list of individual ledger rows with
  //     student + subject + plan info joined.
  //
  // Per the user's instruction, payout methods are EXCLUDED — those stay
  // with the teacher only (the agent doesn't manage payout configuration).
  //
  // financial_ledger stores teacher_share + platform_share per row
  // (snapshotted at payment time), so the summary is a simple SUM.

  // 1. Fetch ALL ledger rows for the teacher (for the summary).
  //    We don't paginate this because we need the full totals.
  const { data: allLedger, error: allErr } = await supabaseServer
    .from('financial_ledger')
    .select('gross_amount, teacher_share, platform_share, gateway_fee, currency, status, created_at')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false });

  if (allErr) throw allErr;

  type LedgerRow = {
    gross_amount: number; teacher_share: number; platform_share: number;
    gateway_fee: number; currency: string; status: string; created_at: string;
    order_id: string; student_id: string; subject_id: string;
  };

  // 2. Build the per-currency summary from all rows.
  const byCurrency = new Map<string, {
    gross: number; teacher: number; platform: number; fees: number; count: number;
  }>();
  for (const r of (allLedger ?? []) as unknown as Array<LedgerRow>) {
    const cur = r.currency || 'EGP';
    if (!byCurrency.has(cur)) byCurrency.set(cur, { gross: 0, teacher: 0, platform: 0, fees: 0, count: 0 });
    const agg = byCurrency.get(cur)!;
    agg.gross += Number(r.gross_amount) || 0;
    agg.teacher += Number(r.teacher_share) || 0;
    agg.platform += Number(r.platform_share) || 0;
    agg.fees += Number(r.gateway_fee) || 0;
    agg.count += 1;
  }

  // 3. Fetch the paginated transaction list with joined student/subject/plan.
  //    We use a range query on financial_ledger ordered by created_at desc.
  const { data: pageRows, error: pageErr } = await supabaseServer
    .from('financial_ledger')
    .select(`
      id, gross_amount, teacher_share, platform_share, gateway_fee,
      net_amount, currency, status, created_at,
      order_id, student_id, subject_id
    `)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (pageErr) throw pageErr;

  type PageRow = {
    id: string; gross_amount: number; teacher_share: number; platform_share: number;
    gateway_fee: number; net_amount: number; currency: string; status: string;
    created_at: string; order_id: string; student_id: string; subject_id: string;
  };
  const transactions = (pageRows ?? []) as unknown as PageRow[];

  // 4. Resolve student names + subject names + plan labels for the page.
  const studentIds = Array.from(new Set(transactions.map(t => t.student_id))).filter(Boolean);
  const subjectIds = Array.from(new Set(transactions.map(t => t.subject_id))).filter(Boolean);
  const orderIds = Array.from(new Set(transactions.map(t => t.order_id))).filter(Boolean);

  let studentNameById = new Map<string, { name: string | null; student_code: string | null }>();
  if (studentIds.length > 0) {
    const { data: students } = await supabaseServer
      .from('users')
      .select('id, name, student_code')
      .in('id', studentIds);
    for (const u of (students ?? []) as unknown as Array<{ id: string; name: string | null; student_code: string | null }>) {
      studentNameById.set(u.id, { name: u.name, student_code: u.student_code });
    }
  }

  let subjectNameById = new Map<string, string>();
  if (subjectIds.length > 0) {
    const { data: subjects } = await supabaseServer
      .from('subjects')
      .select('id, name')
      .in('id', subjectIds);
    for (const s of (subjects ?? []) as unknown as Array<{ id: string; name: string }>) {
      subjectNameById.set(s.id, s.name);
    }
  }

  // Fetch plan info from orders (plan_id + plan_duration_days).
  let planByOrderId = new Map<string, { period_label: string | null; duration_days: number | null }>();
  if (orderIds.length > 0) {
    const { data: orders } = await supabaseServer
      .from('orders')
      .select('id, plan_id, plan_duration_days')
      .in('id', orderIds);
    const planIds = (orders ?? []).map((o: { plan_id: string | null }) => o.plan_id).filter(Boolean) as string[];
    let planLabelById = new Map<string, string>();
    if (planIds.length > 0) {
      const { data: plans } = await supabaseServer
        .from('subject_subscription_plans')
        .select('id, period_label, period_type')
        .in('id', planIds);
      for (const p of (plans ?? []) as unknown as Array<{ id: string; period_label: string; period_type: string }>) {
        planLabelById.set(p.id, p.period_label || p.period_type);
      }
    }
    for (const o of (orders ?? []) as unknown as Array<{ id: string; plan_id: string | null; plan_duration_days: number | null }>) {
      planByOrderId.set(o.id, {
        period_label: o.plan_id ? (planLabelById.get(o.plan_id) ?? null) : null,
        duration_days: o.plan_duration_days,
      });
    }
  }

  // 5. Build the transaction items.
  const items = transactions.map(t => {
    const student = studentNameById.get(t.student_id);
    const plan = planByOrderId.get(t.order_id);
    return {
      id: t.id,
      created_at: t.created_at,
      status: t.status,
      gross_amount: Number(t.gross_amount) || 0,
      teacher_share: Number(t.teacher_share) || 0,
      platform_share: Number(t.platform_share) || 0,
      gateway_fee: Number(t.gateway_fee) || 0,
      net_amount: Number(t.net_amount) || 0,
      currency: t.currency,
      student: {
        id: t.student_id,
        name: student?.name ?? null,
        student_code: student?.student_code ?? null,
      },
      subject: {
        id: t.subject_id,
        name: subjectNameById.get(t.subject_id) ?? null,
      },
      plan: plan ? {
        period_label: plan.period_label,
        duration_days: plan.duration_days,
      } : null,
    };
  });

  const totalCount = (allLedger ?? []).length;

  return NextResponse.json({
    success: true,
    section: 'financialManagement',
    // Summary: per-currency aggregates across ALL transactions (lifetime).
    summary: Array.from(byCurrency.entries()).map(([currency, agg]) => ({
      currency,
      gross: Number(agg.gross.toFixed(2)),
      teacher: Number(agg.teacher.toFixed(2)),
      platform: Number(agg.platform.toFixed(2)),
      fees: Number(agg.fees.toFixed(2)),
      count: agg.count,
    })),
    // Paginated transaction list.
    items,
    total_count: totalCount,
    has_more: offset + items.length < totalCount,
    limit,
    offset,
  });
}

// ──────────────────────────────────────────────────────────────
// v132 Phase 5: handleTracking
//   Per-student performance metrics across ALL the teacher's courses.
//   This is NOT teacher-level aggregate stats (that was the old v130
//   behavior). The agent uses this to FOLLOW UP on individual students.
//
//   Metrics per student:
//     - enrolled_subjects: count of approved enrollments
//     - attendance_rate:   (present + late) / total attendance sessions
//     - quiz_avg_score:    average (score/total*100) across completed quizzes
//     - quiz_completion:   completed quizzes / total quizzes in enrolled subjects
//     - assignment_rate:   submitted assignments / total assignments in enrolled subjects
//     - lesson_progress:   completed lessons / total lessons in enrolled subjects
//     - last_activity:     most recent of: lesson_progress.last_accessed_at,
//                           scores.completed_at, submissions.submitted_at,
//                           attendance_records.checked_in_at, users.created_at
//
//   Pagination: limit/offset apply to the student list (not metrics).
// ──────────────────────────────────────────────────────────────
async function handleTracking(teacherId: string, limit: number, offset: number) {
  // 1. Get the teacher's subject IDs + names.
  const { data: teacherSubjects } = await supabaseServer
    .from('subjects')
    .select('id, name')
    .eq('teacher_id', teacherId);
  const subjectIdList = (teacherSubjects ?? []).map((s: { id: string }) => s.id);
  const subjectNameById = new Map<string, string>(
    (teacherSubjects ?? []).map((s: { id: string; name: string }) => [s.id, s.name])
  );

  if (subjectIdList.length === 0) {
    return NextResponse.json({
      success: true,
      section: 'tracking',
      items: [],
      total_count: 0,
      has_more: false,
      limit,
      offset,
    });
  }

  // 2. Get distinct students enrolled in those subjects (approved only).
  //    We fetch all enrollments (not paginated) because we need to know
  //    which subjects each student is in for the metrics. Pagination
  //    applies to the final student list.
  const { data: allEnrollments } = await supabaseServer
    .from('subject_students')
    .select('student_id, subject_id')
    .in('subject_id', subjectIdList)
    .eq('status', 'approved');

  type EnrollmentRow = { student_id: string; subject_id: string };
  const enrollments = (allEnrollments ?? []) as EnrollmentRow[];

  // Group: student_id → set of subject_ids
  const subjectsByStudent = new Map<string, Set<string>>();
  for (const e of enrollments) {
    if (!subjectsByStudent.has(e.student_id)) subjectsByStudent.set(e.student_id, new Set());
    subjectsByStudent.get(e.student_id)!.add(e.subject_id);
  }

  // Get the distinct student IDs, sorted for stable pagination.
  const allStudentIds = Array.from(subjectsByStudent.keys()).sort();
  const totalCount = allStudentIds.length;
  const pageStudentIds = allStudentIds.slice(offset, offset + limit);

  if (pageStudentIds.length === 0) {
    return NextResponse.json({
      success: true,
      section: 'tracking',
      items: [],
      total_count: totalCount,
      has_more: false,
      limit,
      offset,
    });
  }

  // 3. Fetch student profile info (name, email, code, account_status).
  const { data: studentRows } = await supabaseServer
    .from('users')
    .select('id, name, email, student_code, account_status, created_at')
    .in('id', pageStudentIds);
  const studentInfoById = new Map<string, {
    name: string | null; email: string; student_code: string | null;
    account_status: string | null; created_at: string;
  }>(
    (studentRows ?? []).map((u: Record<string, unknown>) => [
      u.id as string,
      {
        name: u.name as string | null,
        email: u.email as string,
        student_code: u.student_code as string | null,
        account_status: u.account_status as string | null,
        created_at: u.created_at as string,
      },
    ])
  );

  // 4. Fetch attendance sessions for the teacher's subjects.
  //    We only need sessions whose subject_id is in subjectIdList.
  const { data: sessionsData } = await supabaseServer
    .from('attendance_sessions')
    .select('id, subject_id')
    .in('subject_id', subjectIdList);
  type SessionRow = { id: string; subject_id: string };
  const sessions = (sessionsData ?? []) as SessionRow[];
  const sessionsBySubject = new Map<string, string[]>();
  for (const s of sessions) {
    if (!sessionsBySubject.has(s.subject_id)) sessionsBySubject.set(s.subject_id, []);
    sessionsBySubject.get(s.subject_id)!.push(s.id);
  }
  const allSessionIds = sessions.map(s => s.id);

  // 5. Fetch attendance records for the page students.
  //    Key: student_id → session_id → status
  let attendanceByStudent = new Map<string, Map<string, string>>();
  if (allSessionIds.length > 0) {
    const { data: attRecords } = await supabaseServer
      .from('attendance_records')
      .select('session_id, student_id, attendance_status')
      .in('session_id', allSessionIds)
      .in('student_id', pageStudentIds);
    for (const r of (attRecords ?? []) as { session_id: string; student_id: string; attendance_status: string }[]) {
      if (!attendanceByStudent.has(r.student_id)) attendanceByStudent.set(r.student_id, new Map());
      attendanceByStudent.get(r.student_id)!.set(r.session_id, r.attendance_status);
    }
  }

  // 6. Fetch quizzes for the teacher's subjects + scores for the page students.
  const { data: quizzesData } = await supabaseServer
    .from('quizzes')
    .select('id, subject_id')
    .in('subject_id', subjectIdList);
  type QuizRow = { id: string; subject_id: string };
  const quizzes = (quizzesData ?? []) as QuizRow[];
  const quizzesBySubject = new Map<string, string[]>();
  for (const q of quizzes) {
    if (!quizzesBySubject.has(q.subject_id)) quizzesBySubject.set(q.subject_id, []);
    quizzesBySubject.get(q.subject_id)!.push(q.id);
  }
  const allQuizIds = quizzes.map(q => q.id);

  let scoresByStudent = new Map<string, Map<string, { score: number; total: number; completed_at: string }>>();
  if (allQuizIds.length > 0) {
    const { data: scoresData } = await supabaseServer
      .from('scores')
      .select('quiz_id, student_id, score, total, completed_at')
      .in('quiz_id', allQuizIds)
      .in('student_id', pageStudentIds);
    for (const s of ((scoresData ?? []) as unknown as Array<{ quiz_id: string; student_id: string; score: number; total: number; completed_at: string }>)) {
      if (!scoresByStudent.has(s.student_id)) scoresByStudent.set(s.student_id, new Map());
      // Keep the most recent score per quiz (completed_at is not ordered
      // here, so we just take the first occurrence — the DB doesn't
      // guarantee order without an explicit ORDER BY).
      if (!scoresByStudent.get(s.student_id)!.has(s.quiz_id)) {
        scoresByStudent.get(s.student_id)!.set(s.quiz_id, {
          score: Number(s.score) || 0,
          total: Number(s.total) || 0,
          completed_at: s.completed_at,
        });
      }
    }
  }

  // 7. Fetch assignments for the teacher's subjects + submissions for the page students.
  const { data: assignmentsData } = await supabaseServer
    .from('assignments')
    .select('id, subject_id')
    .in('subject_id', subjectIdList);
  type AssignmentRow = { id: string; subject_id: string };
  const assignments = (assignmentsData ?? []) as AssignmentRow[];
  const assignmentsBySubject = new Map<string, string[]>();
  for (const a of assignments) {
    if (!assignmentsBySubject.has(a.subject_id)) assignmentsBySubject.set(a.subject_id, []);
    assignmentsBySubject.get(a.subject_id)!.push(a.id);
  }
  const allAssignmentIds = assignments.map(a => a.id);

  let submissionsByStudent = new Map<string, Set<string>>();
  if (allAssignmentIds.length > 0) {
    const { data: submissionsData } = await supabaseServer
      .from('submissions')
      .select('assignment_id, student_id')
      .in('assignment_id', allAssignmentIds)
      .in('student_id', pageStudentIds);
    for (const s of ((submissionsData ?? []) as unknown as Array<{ assignment_id: string; student_id: string }>)) {
      if (!submissionsByStudent.has(s.student_id)) submissionsByStudent.set(s.student_id, new Set());
      submissionsByStudent.get(s.student_id)!.add(s.assignment_id);
    }
  }

  // 8. Fetch lessons for the teacher's subjects + lesson_progress for the page students.
  const { data: lessonsData } = await supabaseServer
    .from('lessons')
    .select('id, subject_id')
    .in('subject_id', subjectIdList);
  type LessonRow = { id: string; subject_id: string };
  const lessons = (lessonsData ?? []) as LessonRow[];
  const lessonsBySubject = new Map<string, string[]>();
  for (const l of lessons) {
    if (!lessonsBySubject.has(l.subject_id)) lessonsBySubject.set(l.subject_id, []);
    lessonsBySubject.get(l.subject_id)!.push(l.id);
  }
  const allLessonIds = lessons.map(l => l.id);

  // v132 fix: lesson_progress has a `status` column (values: 'not_started',
  // 'in_progress', 'completed', 'failed', 'locked'), NOT an `is_completed`
  // boolean. The old student-performance route used `.eq('is_completed', true)`
  // which silently returned zero rows. We use `.eq('status', 'completed')`.
  let lessonProgressByStudent = new Map<string, { completed: Set<string>; lastAccessed: string | null }>();
  if (allLessonIds.length > 0) {
    const { data: progressData } = await supabaseServer
      .from('lesson_progress')
      .select('lesson_id, student_id, status, last_accessed_at')
      .in('lesson_id', allLessonIds)
      .in('student_id', pageStudentIds);
    for (const p of ((progressData ?? []) as unknown as Array<{ lesson_id: string; student_id: string; status: string; last_accessed_at: string | null }>)) {
      if (!lessonProgressByStudent.has(p.student_id)) {
        lessonProgressByStudent.set(p.student_id, { completed: new Set(), lastAccessed: null });
      }
      const entry = lessonProgressByStudent.get(p.student_id)!;
      if (p.status === 'completed') {
        entry.completed.add(p.lesson_id);
      }
      if (p.last_accessed_at) {
        if (!entry.lastAccessed || p.last_accessed_at > entry.lastAccessed) {
          entry.lastAccessed = p.last_accessed_at;
        }
      }
    }
  }

  // 9. Build the per-student metrics.
  const items = pageStudentIds.map(studentId => {
    const info = studentInfoById.get(studentId);
    const studentSubjects = subjectsByStudent.get(studentId) ?? new Set<string>();
    const subjectIds = Array.from(studentSubjects);

    // ── Attendance ──
    let attPresent = 0, attLate = 0, attAbsent = 0;
    const studentAtt = attendanceByStudent.get(studentId);
    for (const sid of subjectIds) {
      const sessionIds = sessionsBySubject.get(sid) ?? [];
      for (const sessId of sessionIds) {
        const status = studentAtt?.get(sessId);
        if (status === 'present') attPresent++;
        else if (status === 'late') attLate++;
        else if (status === 'absent') attAbsent++;
      }
    }
    const attTotal = attPresent + attLate + attAbsent;
    const attendanceRate = attTotal > 0 ? Math.round(((attPresent + attLate) / attTotal) * 100) : null;

    // ── Quizzes ──
    let quizCompleted = 0;
    let quizScoreSum = 0;
    let quizScoreCount = 0;
    const studentScores = scoresByStudent.get(studentId);
    for (const sid of subjectIds) {
      const quizIds = quizzesBySubject.get(sid) ?? [];
      for (const qid of quizIds) {
        const sc = studentScores?.get(qid);
        if (sc) {
          quizCompleted++;
          if (sc.total > 0) {
            quizScoreSum += (sc.score / sc.total) * 100;
            quizScoreCount++;
          }
        }
      }
    }
    const totalQuizzes = subjectIds.reduce((sum, sid) => sum + (quizzesBySubject.get(sid)?.length ?? 0), 0);
    const quizAvgScore = quizScoreCount > 0 ? Math.round(quizScoreSum / quizScoreCount) : null;
    const quizCompletion = totalQuizzes > 0 ? Math.round((quizCompleted / totalQuizzes) * 100) : null;

    // ── Assignments ──
    let assignmentSubmitted = 0;
    const studentSubs = submissionsByStudent.get(studentId);
    for (const sid of subjectIds) {
      const assignmentIds = assignmentsBySubject.get(sid) ?? [];
      for (const aid of assignmentIds) {
        if (studentSubs?.has(aid)) assignmentSubmitted++;
      }
    }
    const totalAssignments = subjectIds.reduce((sum, sid) => sum + (assignmentsBySubject.get(sid)?.length ?? 0), 0);
    const assignmentRate = totalAssignments > 0 ? Math.round((assignmentSubmitted / totalAssignments) * 100) : null;

    // ── Lesson progress ──
    let lessonsCompleted = 0;
    const studentProgress = lessonProgressByStudent.get(studentId);
    for (const sid of subjectIds) {
      const lessonIds = lessonsBySubject.get(sid) ?? [];
      for (const lid of lessonIds) {
        if (studentProgress?.completed.has(lid)) lessonsCompleted++;
      }
    }
    const totalLessons = subjectIds.reduce((sum, sid) => sum + (lessonsBySubject.get(sid)?.length ?? 0), 0);
    const lessonProgressRate = totalLessons > 0 ? Math.round((lessonsCompleted / totalLessons) * 100) : null;

    // ── Last activity ──
    // Use the most recent of: lesson_progress.last_accessed_at,
    // users.created_at (fallback if no activity yet).
    const lastActivity = studentProgress?.lastAccessed ?? info?.created_at ?? null;

    return {
      id: studentId,
      name: info?.name ?? null,
      email: info?.email ?? '—',
      student_code: info?.student_code ?? null,
      account_status: info?.account_status ?? null,
      enrolled_subjects: subjectIds.length,
      attendance_rate: attendanceRate,
      attendance_detail: { present: attPresent, late: attLate, absent: attAbsent, total: attTotal },
      quiz_avg_score: quizAvgScore,
      quiz_completion: quizCompletion,
      quiz_detail: { completed: quizCompleted, total: totalQuizzes },
      assignment_rate: assignmentRate,
      assignment_detail: { submitted: assignmentSubmitted, total: totalAssignments },
      lesson_progress: lessonProgressRate,
      lesson_detail: { completed: lessonsCompleted, total: totalLessons },
      last_activity: lastActivity,
    };
  });

  return NextResponse.json({
    success: true,
    section: 'tracking',
    items,
    total_count: totalCount,
    has_more: offset + items.length < totalCount,
    limit,
    offset,
  });
}

// ──────────────────────────────────────────────────────────────
// v116: additional section handlers — videos, files, todos,
// notifications, analytics. These give the agent READ-ONLY access
// to the teacher's content for these sections (when the teacher has
// allowed them in allowed_sections).
// ──────────────────────────────────────────────────────────────

async function handleVideos(teacherId: string, limit: number, offset: number) {
  // Fetch videos uploaded for the teacher's subjects. The videos table
  // is named 'videos' with a subject_id FK to subjects.
  const { data: videos, error } = await supabaseServer
    .from('videos')
    .select(`
      id, title, duration_seconds, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (videos ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'videos',
    items: videos ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleFiles(teacherId: string, limit: number, offset: number) {
  // Fetch files uploaded for the teacher's subjects.
  const { data: files, error } = await supabaseServer
    .from('files')
    .select(`
      id, name, file_type, file_size, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (files ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'files',
    items: files ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleTodos(teacherId: string, limit: number, offset: number) {
  // Fetch the teacher's todos.
  const { data: todos, error } = await supabaseServer
    .from('todos')
    .select('id, title, completed, due_date, created_at')
    .eq('user_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (todos ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'todos',
    items: todos ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleNotifications(teacherId: string, limit: number, offset: number) {
  // Fetch the teacher's recent notifications.
  const { data: notifs, error } = await supabaseServer
    .from('notifications')
    .select('id, title, body, type, is_read, created_at')
    .eq('user_id', teacherId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const items = (notifs ?? []) as unknown as Array<{ id: string }>;
  return NextResponse.json({
    success: true,
    section: 'notifications',
    items: notifs ?? [],
    total_count: items.length,
    has_more: false,
    limit,
    offset,
  });
}

async function handleAnalytics(teacherId: string) {
  // Aggregate basic analytics: total enrollments, active subscriptions,
  // pending orders, paid orders — same as dashboard but framed as
  // analytics (the agent's analytics section is a stats summary).
  const { data: teacherSubjects } = await supabaseServer
    .from('subjects')
    .select('id')
    .eq('teacher_id', teacherId);
  const teacherSubjectIds = (teacherSubjects ?? []).map((s: { id: string }) => s.id);

  if (teacherSubjectIds.length === 0) {
    return NextResponse.json({
      success: true,
      section: 'analytics',
      stats: { total_enrollments: 0, active_subscriptions: 0, pending_orders: 0, paid_orders: 0 },
    });
  }

  const [{ count: totalEnrollments }, { count: activeSubs }, { count: pendingCount }, { count: paidCount }] = await Promise.all([
    supabaseServer.from('subject_students').select('id', { count: 'exact', head: true }).in('subject_id', teacherSubjectIds),
    supabaseServer.from('subject_students').select('id', { count: 'exact', head: true }).in('subject_id', teacherSubjectIds).eq('status', 'approved'),
    supabaseServer.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending').in('subject_id', teacherSubjectIds),
    supabaseServer.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'paid').in('subject_id', teacherSubjectIds),
  ]);

  return NextResponse.json({
    success: true,
    section: 'analytics',
    stats: {
      total_enrollments: totalEnrollments ?? 0,
      active_subscriptions: activeSubs ?? 0,
      pending_orders: pendingCount ?? 0,
      paid_orders: paidCount ?? 0,
    },
  });
}
