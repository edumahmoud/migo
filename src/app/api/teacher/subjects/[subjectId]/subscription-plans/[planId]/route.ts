import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ subjectId: string; planId: string }> }

/**
 * PATCH /api/teacher/subjects/[subjectId]/subscription-plans/[planId]
 *   Updates a plan (is_active, price, period_label, duration_days).
 * DELETE /api/teacher/subjects/[subjectId]/subscription-plans/[planId]
 *   Deletes a plan.
 */
async function verifyOwnership(subjectId: string, teacherId: string): Promise<boolean> {
  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();
  return !!subject && (subject as { teacher_id: string }).teacher_id === teacherId;
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const { subjectId, planId } = await ctx.params;

  if (!(await verifyOwnership(subjectId, auth.user.id))) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.is_active !== undefined) updatePayload.is_active = body.is_active;
  if (body.price !== undefined) updatePayload.price = body.price;
  if (body.period_label !== undefined) updatePayload.period_label = body.period_label;
  if (body.duration_days !== undefined) updatePayload.duration_days = body.duration_days;
  if (body.sort_order !== undefined) updatePayload.sort_order = body.sort_order;

  const { data, error } = await supabaseServer
    .from('subject_subscription_plans')
    .update(updatePayload)
    .eq('id', planId)
    .eq('subject_id', subjectId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const { subjectId, planId } = await ctx.params;

  if (!(await verifyOwnership(subjectId, auth.user.id))) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  const { error } = await supabaseServer
    .from('subject_subscription_plans')
    .delete()
    .eq('id', planId)
    .eq('subject_id', subjectId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
