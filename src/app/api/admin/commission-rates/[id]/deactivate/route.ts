import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/commission-rates/[id]/deactivate
 * Deactivates this rate. No rate will be active after this
 * (the RPC falls back to 0% commission if no active rate exists).
 * Existing ledger records are NOT affected (snapshotted).
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  const { error } = await supabaseServer
    .from('commission_rates')
    .update({ is_active: false })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: 'تم تعطيل النسبة. المعاملات الجديدة ستستخدم 0% حتى يتم تفعيل نسبة جديدة.',
  });
}
