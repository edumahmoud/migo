import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * Teacher Registration Agents
 *   GET    /api/teacher/registration-agents        → list current teacher's agents
 *   POST   /api/teacher/registration-agents        → create a new agent
 *
 * As of v65: an agent IS its own "source" (center/external office).
 * The agent row carries display_name + kind + contact fields directly,
 * and teacher_id is set on insert. No more separate source entity.
 */
const KindEnum = z.enum(['center', 'external_office', 'other']);

const CreateSchema = z.object({
  display_name: z.string().trim().min(1).max(120),
  kind: KindEnum.default('center'),
  contact_email: z.string().trim().email().max(254),
  contact_phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  // auth account:
  account_email: z.string().trim().email().max(254),
  account_name: z.string().trim().min(1).max(120).optional(),
});

function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const teacherId = auth.user.id;

  // Direct teacher_id match (v65 path). The `!inner` hint lets us
  // filter on a column from the joined table.
  const { data, error } = await supabaseServer
    .from('registration_agents')
    .select(
      'id, user_id, teacher_id, source_id, display_name, kind, ' +
        'contact_email, contact_phone, address, is_active, created_at, ' +
        'user:users!user_id(id, email, name, username)'
    )
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/teacher/registration-agents] query error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل تحميل وكلاء التسجيل: ' + (error.message || 'unknown') },
      { status: 500 }
    );
  }

  // Fetch students count per agent in one shot.
  const agentIds = ((data ?? []) as unknown as Array<{ id: string }>).map((a) => a.id);
  let countsByAgent: Record<string, number> = {};
  if (agentIds.length > 0) {
    const { data: countRows } = await supabaseServer
      .from('subject_students')
      .select('enrollment_agent_id')
      .in('enrollment_agent_id', agentIds);

    if (Array.isArray(countRows)) {
      for (const row of countRows as Array<{ enrollment_agent_id: string | null }>) {
        if (row.enrollment_agent_id) {
          countsByAgent[row.enrollment_agent_id] =
            (countsByAgent[row.enrollment_agent_id] || 0) + 1;
        }
      }
    }
  }

  const enriched = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((a) => ({
    ...a,
    students_count: countsByAgent[(a as { id: string }).id] ?? 0,
  }));

  return NextResponse.json({ success: true, agents: enriched });
}

export async function POST(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  if (auth.role !== 'teacher') {
    return NextResponse.json(
      { success: false, error: 'يُسمح فقط بدور المعلم بإنشاء وكلاء التسجيل' },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 }
    );
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { display_name, kind, contact_email, contact_phone, address, account_email, account_name } = parsed.data;
  const finalAccountName = account_name || display_name;

  // 1) Reject duplicate account_email.
  const { data: existingUser } = await supabaseServer
    .from('users')
    .select('id, email, role')
    .eq('email', account_email)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json(
      { success: false, error: 'البريد الإلكتروني للحساب مستخدم بالفعل.' },
      { status: 409 }
    );
  }

  // 2) Reject duplicate contact_email (must be unique per agent).
  if (contact_email) {
    const { data: dupContact } = await supabaseServer
      .from('registration_agents')
      .select('id')
      .eq('contact_email', contact_email)
      .maybeSingle();
    if (dupContact) {
      return NextResponse.json(
        { success: false, error: 'بريد التواصل مستخدم لوكيل آخر.' },
        { status: 409 }
      );
    }
  }

  // 3) Create the auth user.
  const tempPassword = generateTempPassword();
  const { data: created, error: createErr } = await supabaseServer.auth.admin.createUser({
    email: account_email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      name: finalAccountName,
      role: 'registration_agent',
    },
  });

  if (createErr || !created?.user) {
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء حساب الوكيل: ' + (createErr?.message ?? 'غير معروف') },
      { status: 500 }
    );
  }

  const newUserId = created.user.id;

  // 4) Ensure public.users row has the correct role (defensive patch).
  const { data: profileRow } = await supabaseServer
    .from('users')
    .select('id, role, name')
    .eq('id', newUserId)
    .maybeSingle();

  if (!profileRow) {
    await supabaseServer
      .from('users')
      .insert({
        id: newUserId,
        email: account_email,
        name: finalAccountName,
        role: 'registration_agent',
      });
  } else if (profileRow.role !== 'registration_agent') {
    await supabaseServer
      .from('users')
      .update({ role: 'registration_agent', name: finalAccountName })
      .eq('id', newUserId);
  } else {
    await supabaseServer.from('users').update({ name: finalAccountName }).eq('id', newUserId);
  }

  // 5) Insert the registration_agents row with teacher_id + metadata directly.
  const { data: agent, error: agentErr } = await supabaseServer
    .from('registration_agents')
    .insert({
      user_id: newUserId,
      teacher_id: auth.user.id,
      display_name,
      kind,
      contact_email,
      contact_phone,
      address,
      is_active: true,
      created_by: auth.user.id,
    })
    .select('id, user_id, teacher_id, display_name, kind, contact_email, contact_phone, address, is_active, created_at')
    .single();

  if (agentErr) {
    // Best-effort cleanup: disable the orphan auth user.
    await supabaseServer.auth.admin.updateUserById(newUserId, { ban_duration: '8h' });
    return NextResponse.json(
      {
        success: false,
        error: 'تم إنشاء حساب المستخدم لكن فشل إدراج صف الوكيل: ' + agentErr.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    agent,
    temporaryPassword: tempPassword,
    user: { id: newUserId, email: account_email, name: finalAccountName },
    note: 'احفظ كلمة المرور المؤقتة الآن — لن يتم عرضها مرة أخرى.',
  });
}
