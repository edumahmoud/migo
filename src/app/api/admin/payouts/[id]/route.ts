import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { getPayoutDetailsAdmin } from '@/lib/payment/payout-domain/service';
import { getAuditLog } from '@/lib/payment/payout-domain/repository';

interface Ctx { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const { id } = await ctx.params;

  const details = await getPayoutDetailsAdmin(id);
  if (!details) return NextResponse.json({ success: false, error: 'المدفوع غير موجود' }, { status: 404 });

  const audit = await getAuditLog(id);
  return NextResponse.json({ success: true, payout: details.payout, ledger_entries: details.ledgerEntries, audit_log: audit });
}
