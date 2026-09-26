import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { setGatewayEnabled, getGatewayById } from '@/lib/payment';
import { auditGatewayEnabled } from '@/lib/payment/audit';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/payment-gateways/[id]/enable
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;
  await setGatewayEnabled(id, true);
  await auditGatewayEnabled(id, authResult.user.id);

  logPaymentEvent({ level: 'info', operation: 'gatewayManagement', success: true, message: `Gateway ${id} enabled` });

  return NextResponse.json({ success: true, message: 'تم تفعيل البوابة' });
}
