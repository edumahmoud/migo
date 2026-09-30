import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/fee-catalog/[id]/activate
 *   - Sets is_active=true for the given fee_catalog row
 *
 * Authorization: admin/superadmin only.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;

  const { data, error } = await supabaseServer
    .from('fee_catalog')
    .update({ is_active: true, updated_at: new Date().toISOString() })
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
