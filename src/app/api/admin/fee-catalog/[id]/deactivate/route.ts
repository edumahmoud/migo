import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/fee-catalog/[id]/deactivate
 *   - Sets is_active=false for the given fee_catalog row
 *   - Refuses to deactivate the 'platform_commission' fee (it's the
 *     default that every order requires — set its value to 0 instead)
 *
 * Authorization: admin/superadmin only.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;

  // Look up the row first to enforce the platform_commission guard
  const { data: existing } = await supabaseServer
    .from('fee_catalog')
    .select('id, code')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ success: false, error: 'الرسوم غير موجودة' }, { status: 404 });
  }
  if ((existing as { code: string }).code === 'platform_commission') {
    return NextResponse.json(
      { success: false, error: 'لا يمكن تعطيل عمولة المنصة — اضبط قيمتها على 0 بدلاً من ذلك' },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from('fee_catalog')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}
