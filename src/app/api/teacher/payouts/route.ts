import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { listPayoutsByTeacher } from '@/lib/payment/payout-domain/repository';
import { toPayoutMetadata } from '@/lib/payment/payout-domain/types';
import { getPayoutLedgerEntries } from '@/lib/payment/payout-domain/repository';

export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const teacherId = auth.user.id; // server-side only

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const pageSize = Math.min(parseInt(searchParams.get('page_size') ?? '25', 10) || 25, 100);
  const status = searchParams.get('status') ?? undefined;

  const { data, total } = await listPayoutsByTeacher(teacherId, { page, pageSize, status });
  const payouts = await Promise.all(data.map(async (p) => {
    const entries = await getPayoutLedgerEntries(p.id);
    return toPayoutMetadata(p, entries.length);
  }));

  return NextResponse.json({
    success: true,
    data: payouts,
    pagination: { page, page_size: pageSize, total_count: total, total_pages: Math.ceil(total / pageSize) },
  });
}
