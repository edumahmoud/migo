import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * Teacher Registration Sources
 *   GET    /api/teacher/registration-sources        → list current teacher's sources
 *   POST   /api/teacher/registration-sources         → create a new source
 */
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['center', 'external_office', 'other']).default('center'),
});

export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const teacherId = auth.user.id;

  const { data, error } = await supabaseServer
    .from('registration_sources')
    .select(
      'id, teacher_id, name, kind, is_active, created_at, updated_at, ' +
        'agents:registration_agents(id, is_active, user_id)'
    )
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل مصادر التسجيل' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, sources: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  if (auth.role !== 'teacher') {
    return NextResponse.json(
      { success: false, error: 'يُسمح فقط بدور المعلم بإنشاء مصادر التسجيل' },
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

  const { data, error } = await supabaseServer
    .from('registration_sources')
    .insert({
      teacher_id: auth.user.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      is_active: true,
    })
    .select('id, teacher_id, name, kind, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'يوجد بالفعل مصدر بهذا الاسم' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء مصدر التسجيل' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, source: data });
}
