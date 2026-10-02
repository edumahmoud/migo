import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { getEligibleBalance } from '@/lib/payment/payout-domain/service';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = new URL(request.url);
  const teacherId = searchParams.get('teacher_id');
  if (!teacherId) return NextResponse.json({ success: false, error: 'teacher_id مطلوب' }, { status: 400 });

  const result = await getEligibleBalance(teacherId);
  return NextResponse.json({ success: true, total_eligible: result.totalEligible.toFixed(2), entries: result.entries });
}
