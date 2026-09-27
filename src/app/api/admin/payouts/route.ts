import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { listAllPayouts } from '@/lib/payment/payout-domain/repository';
import { initiatePayout } from '@/lib/payment/payout-domain/service';
import { toPayoutMetadata } from '@/lib/payment/payout-domain/types';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const pageSize = Math.min(parseInt(searchParams.get('page_size') ?? '25', 10) || 25, 100);
  const status = searchParams.get('status') ?? undefined;
  const teacherId = searchParams.get('teacher_id') ?? undefined;

  try {
    const { data, total } = await listAllPayouts({ page, pageSize, status, teacherId });
    const payouts = await Promise.all(data.map(async (p) => {
      const { getPayoutLedgerEntries } = await import('@/lib/payment/payout-domain/repository');
      const entries = await getPayoutLedgerEntries(p.id);
      return toPayoutMetadata(p, entries.length);
    }));
    return NextResponse.json({
      success: true,
      data: payouts,
      pagination: { page, page_size: pageSize, total_count: total, total_pages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: 'فشل في جلب المدفوعات' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'صيغة غير صحيحة' }, { status: 400 }); }

  const teacherId = String(body.teacher_id ?? '').trim();
  const payoutMethodId = String(body.payout_method_id ?? '').trim();
  const amount = Number(body.amount);
  const currency = String(body.currency ?? 'EGP').trim();
  const idempotencyKey = String(body.idempotency_key ?? '').trim();

  if (!teacherId || !payoutMethodId || !isValidAmount(amount) || !idempotencyKey) {
    return NextResponse.json({ success: false, error: 'بيانات ناقصة' }, { status: 400 });
  }

  try {
    const result = await initiatePayout({
      teacherId, payoutMethodId, amount, currency,
      idempotencyKey,
      internalReference: `PO-${Date.now()}`,
      initiatedBy: auth.user.id,
    });
    return NextResponse.json({ success: true, payout_id: result.payoutId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'فشل الإنشاء';
    if (msg.includes('duplicate')) return NextResponse.json({ success: false, error: 'مفتاح idempotency مكرر' }, { status: 409 });
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}

function isValidAmount(n: number): boolean { return Number.isFinite(n) && n > 0; }
