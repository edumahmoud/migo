import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * PATCH /api/teacher/payment-methods/[id]
 *   - update name / icon / account_identifier / contact / is_active / sort_order
 *
 * DELETE /api/teacher/payment-methods/[id]
 *   - hard delete (verify ownership first)
 */
const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  icon: z.string().trim().min(1).max(20).optional(),
  account_identifier: z.string().trim().min(1).max(200).optional(),
  contact_for_confirmation: z.string().trim().max(120).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function fetchOwnedMethod(id: string, teacherId: string) {
  return supabaseServer
    .from('payment_methods')
    .select('id, teacher_id, name, icon, account_identifier, contact_for_confirmation, is_active, sort_order, created_at, updated_at')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single();
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const { data: existing, error: existErr } = await fetchOwnedMethod(id, auth.user.id);
  if (existErr || !existing) {
    return NextResponse.json(
      { success: false, error: 'وسيلة الدفع غير موجودة أو لا تملكها' },
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
  if (parsed.data.icon !== undefined) updates.icon = parsed.data.icon;
  if (parsed.data.account_identifier !== undefined) updates.account_identifier = parsed.data.account_identifier;
  if (parsed.data.contact_for_confirmation !== undefined) updates.contact_for_confirmation = parsed.data.contact_for_confirmation;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;
  if (parsed.data.sort_order !== undefined) updates.sort_order = parsed.data.sort_order;

  const { data, error } = await supabaseServer
    .from('payment_methods')
    .update(updates)
    .eq('id', id)
    .select('id, teacher_id, name, icon, account_identifier, contact_for_confirmation, is_active, sort_order, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل تحديث وسيلة الدفع' }, { status: 500 });
  }

  return NextResponse.json({ success: true, method: data });
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const { data: existing, error: existErr } = await fetchOwnedMethod(id, auth.user.id);
  if (existErr || !existing) {
    return NextResponse.json(
      { success: false, error: 'وسيلة الدفع غير موجودة أو لا تملكها' },
      { status: 404 }
    );
  }

  const { error } = await supabaseServer
    .from('payment_methods')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل حذف وسيلة الدفع' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
