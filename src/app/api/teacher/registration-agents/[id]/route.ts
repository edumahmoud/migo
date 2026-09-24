import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/teacher/registration-agents/[id]
 *   - activate / deactivate agent (only)
 *
 * DELETE /api/teacher/registration-agents/[id]
 *   - hard delete the agent row.
 *     The auth user is left intact (so historical enrollments still resolve);
 *     the agent can no longer log in to the portal (role stripped to 'student').
 */
const PatchSchema = z.object({
  is_active: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function fetchOwnedAgent(id: string, teacherId: string) {
  // join via source → teacher_id
  const { data, error } = await supabaseServer
    .from('registration_agents')
    .select('id, user_id, source_id, is_active, created_at, source:registration_sources(teacher_id)')
    .eq('id', id)
    .single();

  if (error || !data) return { data: null, error };
  const ownerTeacher = (
    data.source as unknown as { teacher_id: string } | null
  )?.teacher_id;
  if (ownerTeacher !== teacherId) {
    return { data: null, error: { message: 'NOT_OWNER' } };
  }
  return { data, error: null };
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const { data: existing, error: existErr } = await fetchOwnedAgent(id, auth.user.id);
  if (existErr || !existing) {
    return NextResponse.json(
      { success: false, error: 'الوكيل غير موجود أو لا تملكه' },
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
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;

  const { data, error } = await supabaseServer
    .from('registration_agents')
    .update(updates)
    .eq('id', id)
    .select('id, user_id, source_id, is_active, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل تحديث الوكيل' }, { status: 500 });
  }

  return NextResponse.json({ success: true, agent: data });
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const { data: existing, error: existErr } = await fetchOwnedAgent(id, auth.user.id);
  if (existErr || !existing) {
    return NextResponse.json(
      { success: false, error: 'الوكيل غير موجود أو لا تملكه' },
      { status: 404 }
    );
  }

  // Strip role back to 'student' so the auth user can no longer access the
  // agent portal, but historical enrollments remain intact (FK stays valid).
  await supabaseServer
    .from('users')
    .update({ role: 'student', updated_at: new Date().toISOString() })
    .eq('id', existing.user_id);

  // Then remove the registration_agents row (ON DELETE SET NULL on
  // subject_students.enrollment_agent_id keeps the historical enrollments).
  const { error } = await supabaseServer
    .from('registration_agents')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل حذف الوكيل' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
