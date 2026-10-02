import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { getPayoutDetails } from '@/lib/payment/payout-domain/service';

interface Ctx { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const teacherId = auth.user.id; // server-side only
  const { id } = await ctx.params;

  const details = await getPayoutDetails(id, teacherId);
  if (!details) return NextResponse.json({ success: false, error: 'المدفوع غير موجود' }, { status: 404 });

  return NextResponse.json({ success: true, payout: details });
}
