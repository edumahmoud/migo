import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * Teacher Registration Agents
 *   GET    /api/teacher/registration-agents        → list agents in current teacher's sources
 *   POST   /api/teacher/registration-agents         → create a new agent (creates auth user
 *                                                     + users row + registration_agents row).
 *
 * The temp password is returned ONCE in the response so the teacher can hand it
 * to the agent in person. It is NOT stored in plaintext anywhere.
 */
const CreateSchema = z.object({
  source_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
});

function generateTempPassword(): string {
  // 10-char base32-ish password (avoids ambiguous characters)
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

  const { data, error } = await supabaseServer
    .from('registration_agents')
    .select(
      'id, user_id, source_id, is_active, created_at, ' +
        'source:registration_sources(id, name, kind), ' +
        'user:users(id, email, name, username)'
    )
    .in(
      'source_id',
      (
        await supabaseServer
          .from('registration_sources')
          .select('id')
          .eq('teacher_id', teacherId)
        ).data?.map((s: { id: string }) => s.id) ?? []
    )
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل وكلاء التسجيل' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, agents: data ?? [] });
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

  // Verify the source belongs to the requesting teacher (defense-in-depth;
  // RLS also blocks the INSERT below if not).
  const { data: sourceRow, error: sourceErr } = await supabaseServer
    .from('registration_sources')
    .select('id, teacher_id')
    .eq('id', parsed.data.source_id)
    .eq('teacher_id', auth.user.id)
    .single();

  if (sourceErr || !sourceRow) {
    return NextResponse.json(
      { success: false, error: 'مصدر التسجيل غير موجود أو لا تملكه' },
      { status: 403 }
    );
  }

  // 1) Check if email is already in use → reject, no duplicate accounts.
  const { data: existingUser } = await supabaseServer
    .from('users')
    .select('id, email, role')
    .eq('email', parsed.data.email)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json(
      {
        success: false,
        error: 'البريد الإلكتروني مستخدم بالفعل. لا يمكن إنشاء وكيل بحساب موجود.',
      },
      { status: 409 }
    );
  }

  // 2) Create the auth user with role 'registration_agent'.
  const tempPassword = generateTempPassword();
  const { data: created, error: createErr } = await supabaseServer.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      name: parsed.data.name,
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

  // 3) The handle_new_user() trigger should have inserted the public.users row
  //    with role='registration_agent' from raw_user_meta_data->>'role'.
  //    Verify + patch defensively if the trigger set role='student'.
  const { data: profileRow } = await supabaseServer
    .from('users')
    .select('id, role, name')
    .eq('id', newUserId)
    .maybeSingle();

  if (!profileRow) {
    // Race: trigger hasn't run yet. Insert manually.
    await supabaseServer
      .from('users')
      .insert({
        id: newUserId,
        email: parsed.data.email,
        name: parsed.data.name,
        role: 'registration_agent',
      });
  } else if (profileRow.role !== 'registration_agent') {
    await supabaseServer
      .from('users')
      .update({ role: 'registration_agent', name: parsed.data.name })
      .eq('id', newUserId);
  } else {
    await supabaseServer.from('users').update({ name: parsed.data.name }).eq('id', newUserId);
  }

  // 4) Insert the registration_agents row (RLS allows because source belongs to teacher).
  const { data: agent, error: agentErr } = await supabaseServer
    .from('registration_agents')
    .insert({
      user_id: newUserId,
      source_id: parsed.data.source_id,
      is_active: true,
      created_by: auth.user.id,
    })
    .select('id, user_id, source_id, is_active, created_at')
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
    user: { id: newUserId, email: parsed.data.email, name: parsed.data.name },
    note: 'احفظ كلمة المرور المؤقتة الآن — لن يتم عرضها مرة أخرى.',
  });
}
