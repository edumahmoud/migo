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
  'tracking',
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
      case 'registration':
        return await handleRegistration(teacherId, limit, offset);
      case 'summaries':
        return await handleSummaries(teacherId, limit, offset);
      case 'questionBank':
        return await handleQuestionBank(teacherId, limit, offset);
      case 'scormLibrary':
        return await handleScormLibrary(teacherId, limit, offset);
      case 'financialManagement':
        return await handleFinancial(teacherId);
      case 'videos':
        return await handleVideos(teacherId, limit, offset);
      case 'files':
        return await handleFiles(teacherId, limit, offset);
      case 'todos':
        return await handleTodos(teacherId, limit, offset);
      case 'notifications':
        return await handleNotifications(teacherId, limit, offset);
      case 'analytics':
        return await handleAnalytics(teacherId);
      case 'tracking':
        // v130: reuse analytics handler for tracking (same data shape)
        return await handleAnalytics(teacherId);
      default:
        // Sections that require complex joins or are not data-bearing
        // (tracking/calendar/reports/chat) return an empty payload so
        // the client UI can render a "preview only" placeholder.
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
    // v130 fix: count DISTINCT student_id, not enrollment rows
    const { data: distinctStudents } = await supabaseServer
      .from('subject_students')
      .select('student_id')
      .in('subject_id', teacherSubjectIds)
      .eq('status', 'approved');
    const uniqueIds = new Set((distinctStudents ?? []).map((r: { student_id: string }) => r.student_id));
    studentsCount = uniqueIds.size;
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

  const items = (subjects ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    name: s.name as string,
    level: s.level as string | null,
    sub_level: s.sub_level as string | null,
    price: s.price as number | null,
    is_paused: s.is_paused as boolean,
    students_count: Array.isArray(s.subject_students_count) ? (s.subject_students_count[0] as { count: number })?.count ?? 0 : 0,
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
