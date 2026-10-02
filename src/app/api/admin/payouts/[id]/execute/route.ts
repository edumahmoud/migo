import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { executePayout } from '@/lib/payment/payout-domain/service';

interface Ctx { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const { id } = await ctx.params;

  try {
    const result = await executePayout(id, auth.user.id);
    return NextResponse.json({ success: true, status: result.status, provider_reference: result.providerReference });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'فشل التنفيذ';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
