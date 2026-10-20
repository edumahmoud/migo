import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { notifyUsers } from '@/lib/notifications-service';

/**
 * POST /api/sections/activation-request
 *
 * A student or teacher submits an activation request for a locked section
 * OR for additional storage quota.
 *
 * Body: {
 *   sectionKey: string,     // e.g. 'summaries' or 'files'
 *   planType: 'monthly' | 'yearly',
 *   notes?: string,         // optional message to the admin
 *   requestType?: 'section_unlock' | 'storage_upgrade',  // default: 'section_unlock'
 *   planId?: string,        // for storage_upgrade: the storage_plans.id
 * }
 *
 * For storage_upgrade requests:
 *   - The lock check on the files section is SKIPPED (storage upgrades
 *     are available even when the files section is not locked).
 *   - On insert, the request is flagged so the admin UI can render it
 *     in the storage tab.
 *   - Notifications are sent to ALL admins + the user's linked teachers.
 *
 * The user's name, email, and phone are snapshotted from their profile
 * so the admin sees them even if the user later changes their profile.
 *
 * If the user already has a PENDING request for the same section + type,
 * we return 409 (don't create a duplicate).
 */
const RequestSchema = z.object({
  sectionKey: z.string().min(1).max(100),
  planType: z.enum(['monthly', 'yearly']),
  notes: z.string().max(1000).optional(),
  requestType: z.enum(['section_unlock', 'storage_upgrade']).optional(),
  planId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (role !== 'student' && role !== 'teacher') {
    return NextResponse.json({ error: 'هذه الميزة للطلاب والمعلمين فقط' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'البيانات غير صالحة' }, { status: 400 });
  }

  const { sectionKey, planType, notes, requestType, planId } = parsed.data;
  const isStorageUpgrade = requestType === 'storage_upgrade';

  // 1. For section_unlock: verify the section is actually locked for this role.
  //    For storage_upgrade: SKIP the lock check — storage upgrades are
  //    available even when the files section is not locked.
  if (!isStorageUpgrade) {
    const { data: configRow } = await supabaseServer
      .from('locked_sections_config')
      .select('*')
      .eq('section_key', sectionKey)
      .maybeSingle();

    const config = configRow as Record<string, unknown> | null;
    const roleLockedField = role === 'student' ? 'student_locked' : 'teacher_locked';
    if (!config || !config.is_active || !config[roleLockedField]) {
      return NextResponse.json({ error: 'هذا القسم غير مقفل' }, { status: 400 });
    }
  }

  // 2. Check if the user already has an active unlock (shouldn't happen
  //    from the UI, but defense in depth).
  //    For storage upgrades, this check is irrelevant — skip it.
  if (!isStorageUpgrade) {
    const now = new Date().toISOString();
    const { data: existingUnlock } = await supabaseServer
      .from('user_section_unlocks')
      .select('id')
      .eq('user_id', auth.user.id)
      .eq('section_key', sectionKey)
      .eq('is_active', true)
      .gte('expires_at', now)
      .maybeSingle();
    if (existingUnlock) {
      return NextResponse.json({ error: 'القسم مفعّل بالفعل' }, { status: 409 });
    }
  }

  // 3. Check if the user already has a PENDING request for this section + type.
  //    For storage_upgrade, dedup by plan_id if provided (one pending per plan).
  let pendingQuery = supabaseServer
    .from('section_activation_requests')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('section_key', sectionKey)
    .eq('status', 'pending');

  if (isStorageUpgrade) {
    pendingQuery = pendingQuery.eq('request_type', 'storage_upgrade');
    if (planId) {
      pendingQuery = pendingQuery.eq('plan_id', planId);
    }
  } else {
    pendingQuery = pendingQuery.or('request_type.is.null,request_type.eq.section_unlock');
  }

  const { data: existingReq } = await pendingQuery.maybeSingle();
  if (existingReq) {
    return NextResponse.json(
      { error: 'لديك طلب قيد المراجعة لهذا القسم بالفعل' },
      { status: 409 },
    );
  }

  // 4. Fetch the user's profile for the snapshot.
  const { data: profile } = await supabaseServer
    .from('users')
    .select('name, email, phone')
    .eq('id', auth.user.id)
    .maybeSingle();

  // 5. Insert the request.
  const insertRow: Record<string, unknown> = {
    user_id: auth.user.id,
    user_role: role,
    section_key: sectionKey,
    plan_type: planType,
    user_name: profile?.name ?? null,
    user_email: profile?.email ?? null,
    user_phone: profile?.phone ?? null,
    notes: notes ?? null,
    status: 'pending',
  };
  if (isStorageUpgrade) {
    insertRow.request_type = 'storage_upgrade';
    if (planId) insertRow.plan_id = planId;
  }

  const { data: req, error: insertErr } = await supabaseServer
    .from('section_activation_requests')
    .insert(insertRow)
    .select('id')
    .single();

  if (insertErr) {
    console.error('[activation-request] insert error:', insertErr);
    return NextResponse.json({ error: 'فشل إرسال الطلب' }, { status: 500 });
  }

  // 6. Notify all admins + the user's linked teachers (best-effort, non-blocking).
  //    For storage upgrades, the request must reach the admin AND the
  //    teacher who will approve/handle the payment.
  notifyAdminsAndLinkedTeachers({
    userId: auth.user.id,
    role,
    sectionKey,
    isStorageUpgrade,
    planId,
    notes,
    requestId: req.id,
  }).catch((err) => {
    console.warn('[activation-request] notify failed:', err?.message || err);
  });

  return NextResponse.json({ success: true, requestId: req.id });
}

/**
 * Send notifications about a new activation/storage-upgrade request.
 * Recipients:
 *   - All admins + superadmins
 *   - If the requester is a student: all teachers linked to them via
 *     subject_students → subjects.teacher_id
 *   - If the requester is a teacher: skip (they ARE the teacher)
 */
async function notifyAdminsAndLinkedTeachers(args: {
  userId: string;
  role: string;
  sectionKey: string;
  isStorageUpgrade: boolean;
  planId?: string;
  notes?: string;
  requestId: string;
}): Promise<void> {
  const { userId, role, sectionKey, isStorageUpgrade, requestId } = args;

  // Gather all admin/superadmin user IDs.
  const { data: admins } = await supabaseServer
    .from('users')
    .select('id')
    .in('role', ['admin', 'superadmin']);
  const adminIds = (admins ?? []).map((a: { id: string }) => a.id);

  // Gather linked teachers (for students only).
  let teacherIds: string[] = [];
  if (role === 'student') {
    const { data: links } = await supabaseServer
      .from('subject_students')
      .select('subjects!inner(teacher_id)')
      .eq('student_id', userId)
      .eq('status', 'approved');
    teacherIds = (links ?? [])
      .map((l: { subjects?: { teacher_id?: string } | { teacher_id?: string }[] }) => {
        const s = l.subjects as unknown as { teacher_id?: string } | { teacher_id?: string }[];
        if (Array.isArray(s)) return s[0]?.teacher_id;
        return s?.teacher_id;
      })
      .filter((id: unknown): id is string => Boolean(id));
    teacherIds = [...new Set(teacherIds)];
  }

  const recipientIds = [...new Set([...adminIds, ...teacherIds])];
  if (recipientIds.length === 0) return;

  const title = isStorageUpgrade
    ? 'طلب شراء مساحة تخزين إضافية'
    : 'طلب تفعيل قسم مقفل';
  const message = isStorageUpgrade
    ? `طلب جديد لشراء مساحة تخزين (${args.notes ?? 'بدون ملاحظات'}). يرجى المراجعة والتفعيل.`
    : `طلب جديد لتفعيل قسم "${sectionKey}". يرجى المراجعة.`;

  await notifyUsers(
    recipientIds,
    'system',
    title,
    message,
    '/admin?tab=requests',
  );
}

/**
 * GET /api/sections/activation-request
 *
 * Returns the current user's activation requests (all statuses).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data: requests, error } = await supabaseServer
    .from('section_activation_requests')
    .select('id, section_key, plan_type, status, created_at, processed_at, notes')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'فشل جلب الطلبات' }, { status: 500 });
  }

  return NextResponse.json({ success: true, requests: requests ?? [] });
}
