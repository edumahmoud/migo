import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/fee-catalog/[id]
 *   - Updates name, description, value, sort_order (NOT code — code is
 *     immutable after creation since order_fees snapshot it)
 *   - Cannot change fee_kind (a percentage fee can't become flat —
 *     create a new fee instead)
 *
 * DELETE /api/admin/fee-catalog/[id]
 *   - Hard-deletes the fee. Refuses if any order_fees reference it.
 *
 * Authorization: admin/superadmin only.
 */

const PatchSchema = z.object({
  name_ar: z.string().min(1).max(100).optional(),
  name_en: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  value: z.number().min(0).optional(),
  sort_order: z.number().int().min(0).optional(),
});

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Validate value if provided
  if (parsed.data.value !== undefined) {
    // Look up the fee_kind
    const { data: existing } = await supabaseServer
      .from('fee_catalog')
      .select('fee_kind')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: 'الرسوم غير موجودة' }, { status: 404 });
    }
    if ((existing as { fee_kind: string }).fee_kind === 'percentage' && parsed.data.value > 100) {
      return NextResponse.json(
        { success: false, error: 'قيمة النسبة يجب أن تكون بين 0 و 100' },
        { status: 400 },
      );
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name_ar !== undefined) update.name_ar = parsed.data.name_ar;
  if (parsed.data.name_en !== undefined) update.name_en = parsed.data.name_en;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.value !== undefined) update.value = parsed.data.value;
  if (parsed.data.sort_order !== undefined) update.sort_order = parsed.data.sort_order;

  const { data, error } = await supabaseServer
    .from('fee_catalog')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'الرسوم غير موجودة' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;

  // Check if any order_fees reference this fee_catalog_id
  const { count, error: countErr } = await supabaseServer
    .from('order_fees')
    .select('id', { count: 'exact', head: true })
    .eq('fee_catalog_id', id);
  if (countErr) {
    return NextResponse.json({ success: false, error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `لا يمكن حذف هذه الرسوم — تم تطبيقها على ${count} طلب. يمكنك تعطيلها بدلاً من ذلك.`,
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseServer
    .from('fee_catalog')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
