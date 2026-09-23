import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/teacher/registration-sources/[id]
 *   - rename source / toggle active
 *
 * DELETE /api/teacher/registration-sources/[id]
 *   - hard delete (server-side also blocks when active agents exist)
 */
const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['center', 'external_office', 'other']).optional(),
  is_active: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function fetchOwnedSource(id: string, teacherId: string) {
  return supabaseServer
    .from('registration_sources')
    .select('id, teacher_id, name, kind, is_active, created_at, updated_at')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single();
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const { data: existing, error: existErr } = await fetchOwnedSource(id, auth.user.id);
  if (existErr || !existing) {
    return NextResponse.json(
      { success: false, error: 'المصدر غير موجود أو لا تملك صلاحية تعديله' },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;

  const { data, error } = await supabaseServer
    .from('registration_sources')
    .update(updates)
    .eq('id', id)
    .select('id, teacher_id, name, kind, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'يوجد بالفعل مصدر بهذا الاسم' },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: 'فشل تحديث المصدر' }, { status: 500 });
  }

  return NextResponse.json({ success: true, source: data });
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const { data: existing, error: existErr } = await fetchOwnedSource(id, auth.user.id);
  if (existErr || !existing) {
    return NextResponse.json(
      { success: false, error: 'المصدر غير موجود أو لا تملك صلاحية حذفه' },
      { status: 404 }
    );
  }

  // Block deletion if there are any (active or inactive) agents still attached.
  const { count } = await supabaseServer
    .from('registration_agents')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'لا يمكن حذف مصدر يحتوي على وكلاء. قم بحذف الوكلاء أولاً.',
      },
      { status: 409 }
    );
  }

  const { error } = await supabaseServer.from('registration_sources').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ success: false, error: 'فشل حذف المصدر' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
