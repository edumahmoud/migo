import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { cancelPayout } from '@/lib/payment/payout-domain/service';

interface Ctx { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const { id } = await ctx.params;

  try {
    await cancelPayout(id, auth.user.id);
    return NextResponse.json({ success: true, message: 'تم إلغاء الدفعة' });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'فشل الإلغاء' }, { status: 400 });
  }
}
