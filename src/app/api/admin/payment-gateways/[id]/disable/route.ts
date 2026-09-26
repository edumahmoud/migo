import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { setGatewayEnabled, getGatewayById } from '@/lib/payment';
import { auditGatewayDisabled } from '@/lib/payment/audit';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/payment-gateways/[id]/disable
 * Cannot disable the default gateway (would leave no usable default).
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  // Check if this is the default gateway — don't allow disabling it
  const gateway = await getGatewayById(id);
  if (gateway?.isDefault) {
    return NextResponse.json(
      { success: false, error: 'لا يمكن تعطيل البوابة الافتراضية. عيّن بوابة أخرى كافتراضية أولاً.' },
      { status: 400 },
    );
  }

  await setGatewayEnabled(id, false);
  await auditGatewayDisabled(id, authResult.user.id);

  logPaymentEvent({ level: 'info', operation: 'gatewayManagement', success: true, message: `Gateway ${id} disabled` });

  return NextResponse.json({ success: true, message: 'تم تعطيل البوابة' });
}
