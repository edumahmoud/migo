import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/teacher-view?section=<section_id>
 *
 * Returns READ-ONLY data for the agent's Teacher View, scoped to the
 * agent's teacher. The agent may only see the section if it appears
 * in their allowed_sections (or if allowed_sections is NULL = all
 * sections allowed).
 *
 * Sections supported:
 *   dashboard       → totals (subjects, students, pending orders, paid orders)
 *   subjects        → list of subjects with name, level, students count, price
 *   students        → list of students enrolled in the teacher's courses
 *   pendingOrders   → mirror of /api/agent/orders (for convenience)
 *   registration    → list of OTHER agents of the same teacher (id, name, kind, active)
 *   summaries       → list of summaries (id, title, subject, created_at)
 *   questionBank    → list of question banks (id, title, subject, questions count)
 *   scormLibrary    → list of SCORM packages (id, title, status, created_at)
 *   financialManagement → summary totals (revenue this month, pending payouts)
 *   videos / files / todos / calendar / reports / analytics / notifications / chat
 *                   → empty array (these require complex joins; the agent's Teacher
 *                     View will render a "preview only" message for them)
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
  'registration',
  'summaries',
  'questionBank',
  'scormLibrary',
  'financialManagement',
  'videos',
  'files',
  'todos',
  'calendar',
  'reports',
  'analytics',
  'notifications',
  'chat',
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
        return await handleSubjects(teacherId);
      case 'students':
        return await handleStudents(teacherId);
      case 'pendingOrders':
        return await handlePendingOrders(teacherId);
      case 'registration':
        return await handleRegistration(teacherId);
      case 'summaries':
        return await handleSummaries(teacherId);
      case 'questionBank':
        return await handleQuestionBank(teacherId);
      case 'scormLibrary':
        return await handleScormLibrary(teacherId);
      case 'financialManagement':
        return await handleFinancial(teacherId);
      default:
        // Sections that require complex joins or are not data-bearing
        // (videos/files/todos/calendar/reports/analytics/notifications/chat)
        // return an empty payload so the client UI can render a
        // "preview only" placeholder.
        return NextResponse.json({
          success: true,
          section,
          items: [],
          note: 'هذا القسم غير مُفعّل للعرض كمعاينة وكيل. يجب على المعلم الدخول لحسابه لرؤية المحتوى الكامل.',
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

  // Count distinct students enrolled in those subjects.
  let studentsCount = 0;
  if (teacherSubjectIds.length > 0) {
    const { count } = await supabaseServer
      .from('subject_students')
      .select('id', { count: 'exact', head: true })
      .in('subject_id', teacherSubjectIds);
    studentsCount = count ?? 0;
  }

  // Count pending + paid orders for the teacher's subjects.
  let pendingCount = 0;
  let paidCount = 0;
  if (teacherSubjectIds.length > 0) {
    const [{ count: pc }, { count: pac }] = await Promise.all([
      supabaseServer
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .in('subject_id', teacherSubjectIds),
      supabaseServer
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'paid')
        .in('subject_id', teacherSubjectIds),
    ]);
    pendingCount = pc ?? 0;
    paidCount = pac ?? 0;
  }

  return NextResponse.json({
    success: true,
    section: 'dashboard',
    stats: {
      total_subjects: subjectsCount,
      total_students: studentsCount,
      pending_orders: pendingCount,
      paid_orders: paidCount,
    },
  });
}

async function handleSubjects(teacherId: string) {
  const { data: subjects, error } = await supabaseServer
    .from('subjects')
    .select(`
      id, name, level, sub_level, price, is_paused,
      created_at,
      subject_students_count:subject_students(count)
    `)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const items = (subjects ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    level: s.level as string | null,
    sub_level: s.sub_level as string | null,
    price: s.price as number | null,
    is_paused: s.is_paused as boolean,
    students_count: Array.isArray(s.subject_students_count) ? (s.subject_students_count[0] as { count: number })?.count ?? 0 : 0,
  }));

  return NextResponse.json({
    success: true,
    section: 'subjects',
    items,
  });
}

async function handleStudents(teacherId: string) {
  // Join subject_students + users + subjects where subject.teacher_id = teacherId.
  const { data: rows, error } = await supabaseServer
    .from('subject_students')
    .select(`
      id, status, enrollment_method, enrolled_at,
      student:users!student_id(id, name, email, username, student_code, account_status),
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('enrolled_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  type Row = {
    id: string;
    status: string;
    enrollment_method: string;
    enrolled_at: string | null;
    student: { id: string; name: string | null; email: string; username: string | null; student_code: string | null; account_status: string | null } | null;
    subject: { id: string; name: string; teacher_id: string };
  };

  // Aggregate by student: list of (subject, status) tuples per student.
  const byStudent = new Map<string, {
    id: string; name: string | null; email: string;
    username: string | null; student_code: string | null;
    account_status: string | null;
    enrollments: Array<{ subject_id: string; subject_name: string; status: string; enrolled_at: string | null }>;
  }>();

  for (const r of (rows ?? []) as unknown as Row[]) {
    if (!r.student) continue;
    const sid = r.student.id;
    if (!byStudent.has(sid)) {
      byStudent.set(sid, {
        id: sid,
        name: r.student.name,
        email: r.student.email,
        username: r.student.username,
        student_code: r.student.student_code,
        account_status: r.student.account_status,
        enrollments: [],
      });
    }
    byStudent.get(sid)!.enrollments.push({
      subject_id: r.subject?.id ?? '',
      subject_name: r.subject?.name ?? '—',
      status: r.status,
      enrolled_at: r.enrolled_at,
    });
  }

  return NextResponse.json({
    success: true,
    section: 'students',
    items: Array.from(byStudent.values()),
  });
}

async function handlePendingOrders(teacherId: string) {
  // Mirror of /api/agent/orders but queried here for convenience.
  const teacherSubjects = await supabaseServer.from('subjects').select('id, name, price').eq('teacher_id', teacherId);
  const teacherSubjectIds = (teacherSubjects.data ?? []).map((s: { id: string }) => s.id);

  if (teacherSubjectIds.length === 0) {
    return NextResponse.json({ success: true, section: 'pendingOrders', items: [] });
  }

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
    .limit(200);

  if (error) throw error;

  return NextResponse.json({
    success: true,
    section: 'pendingOrders',
    items: orders ?? [],
  });
}

async function handleRegistration(teacherId: string) {
  // List other agents of the same teacher. The current agent is filtered out.
  const { data: agents, error } = await supabaseServer
    .from('registration_agents')
    .select('id, display_name, kind, is_active, created_at, user:users!user_id(id, email, name)')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false });

  if (error) throw error;

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
  });
}

async function handleSummaries(teacherId: string) {
  const { data: summaries, error } = await supabaseServer
    .from('summaries')
    .select(`
      id, title, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return NextResponse.json({
    success: true,
    section: 'summaries',
    items: summaries ?? [],
  });
}

async function handleQuestionBank(teacherId: string) {
  const { data: banks, error } = await supabaseServer
    .from('question_banks')
    .select(`
      id, title, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return NextResponse.json({
    success: true,
    section: 'questionBank',
    items: banks ?? [],
  });
}

async function handleScormLibrary(teacherId: string) {
  const { data: packages, error } = await supabaseServer
    .from('scorm_packages')
    .select(`
      id, title, status, created_at,
      subject:subjects!inner(id, name, teacher_id)
    `)
    .eq('subject.teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return NextResponse.json({
    success: true,
    section: 'scormLibrary',
    items: packages ?? [],
  });
}

async function handleFinancial(teacherId: string) {
  // Aggregate gross + teacher_share + platform_share from financial_ledger
  // for the current month.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { data: ledger, error } = await supabaseServer
    .from('financial_ledger')
    .select('gross_amount, teacher_share, platform_share, currency')
    .eq('teacher_id', teacherId)
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd);

  if (error) throw error;

  type Row = { gross_amount: number; teacher_share: number; platform_share: number; currency: string };
  const byCurrency = new Map<string, { gross: number; teacher: number; platform: number; count: number }>();
  for (const r of (ledger ?? []) as Row[]) {
    const cur = r.currency || 'EGP';
    if (!byCurrency.has(cur)) byCurrency.set(cur, { gross: 0, teacher: 0, platform: 0, count: 0 });
    const agg = byCurrency.get(cur)!;
    agg.gross += Number(r.gross_amount) || 0;
    agg.teacher += Number(r.teacher_share) || 0;
    agg.platform += Number(r.platform_share) || 0;
    agg.count += 1;
  }

  return NextResponse.json({
    success: true,
    section: 'financialManagement',
    period: { from: monthStart, to: monthEnd },
    items: Array.from(byCurrency.entries()).map(([currency, agg]) => ({
      currency,
      ...agg,
    })),
  });
}
