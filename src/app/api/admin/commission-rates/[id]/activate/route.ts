import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/commission-rates/[id]/activate
 * Activates this rate and deactivates any currently active one.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  // Verify the rate exists
  const { data: rate } = await supabaseServer
    .from('commission_rates')
    .select('id, rate_percentage')
    .eq('id', id)
    .maybeSingle();

  if (!rate) {
    return NextResponse.json({ success: false, error: 'النسبة غير موجودة' }, { status: 404 });
  }

  // Deactivate any currently active rate
  await supabaseServer
    .from('commission_rates')
    .update({ is_active: false })
    .eq('is_active', true)
    .neq('id', id);

  // Activate the requested rate
  const { error } = await supabaseServer
    .from('commission_rates')
    .update({ is_active: true })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: `تم تفعيل النسبة ${(rate as { rate_percentage: number }).rate_percentage}%`,
  });
}
