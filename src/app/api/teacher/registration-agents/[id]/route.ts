import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/teacher/registration-agents/[id]
 *   - update display_name / kind / contact_email / contact_phone / address
 *   - toggle is_active
 *
 * DELETE /api/teacher/registration-agents/[id]
 *   - hard delete the agent row.
 *     The auth user is left intact (so historical enrollments still resolve);
 *     the agent can no longer log in to the portal (role stripped to 'student').
 */
const PatchSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['center', 'external_office', 'other']).optional(),
  contact_email: z.string().trim().email().max(254).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  is_active: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function fetchOwnedAgent(id: string, teacherId: string) {
  // v65 path: agent.teacher_id is the direct ownership check.
  const { data, error } = await supabaseServer
    .from('registration_agents')
    .select('id, user_id, teacher_id, source_id, is_active, created_at, display_name, kind')
    .eq('id', id)
    .single();

  if (error || !data) return { data: null, error };

  const ownerTeacher = (data as { teacher_id: string | null }).teacher_id;
  // Backward compat: if agent has no teacher_id (pre-v65), check via source.
  if (!ownerTeacher) {
    const sourceId = (data as { source_id: string | null }).source_id;
    if (sourceId) {
      const { data: src } = await supabaseServer
        .from('registration_sources')
        .select('teacher_id')
        .eq('id', sourceId)
        .maybeSingle();
      const srcTeacherId = (src as { teacher_id: string } | null)?.teacher_id;
      if (srcTeacherId !== teacherId) {
        return { data: null, error: { message: 'NOT_OWNER' } };
      }
    } else {
      return { data: null, error: { message: 'NOT_OWNER' } };
    }
  } else if (ownerTeacher !== teacherId) {
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
  if (parsed.data.display_name !== undefined) updates.display_name = parsed.data.display_name;
  if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
  if (parsed.data.contact_email !== undefined) updates.contact_email = parsed.data.contact_email;
  if (parsed.data.contact_phone !== undefined) updates.contact_phone = parsed.data.contact_phone;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;

  const { data, error } = await supabaseServer
    .from('registration_agents')
    .update(updates)
    .eq('id', id)
    .select(
      'id, user_id, teacher_id, display_name, kind, contact_email, contact_phone, address, is_active, created_at, updated_at'
    )
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
    .eq('id', (existing as { user_id: string }).user_id);

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
