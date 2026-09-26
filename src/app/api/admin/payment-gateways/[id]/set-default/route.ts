import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { setDefaultGateway, getGatewayById, getDefaultGateway } from '@/lib/payment';
import { auditGatewayDefaultChanged } from '@/lib/payment/audit';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/payment-gateways/[id]/set-default
 * Sets this gateway as the default. Clears any existing default first.
 * The gateway must be enabled before it can be set as default.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  // Check the gateway exists + is enabled
  const gateway = await getGatewayById(id);
  if (!gateway) {
    return NextResponse.json({ success: false, error: 'البوابة غير موجودة' }, { status: 404 });
  }
  if (!gateway.isEnabled) {
    return NextResponse.json(
      { success: false, error: 'يجب تفعيل البوابة أولاً قبل تعيينها كافتراضية' },
      { status: 400 },
    );
  }

  // Find the previous default (for audit log)
  const previousDefault = await getDefaultGateway();
  const previousDefaultId = previousDefault?.id ?? null;

  await setDefaultGateway(id);
  await auditGatewayDefaultChanged(id, previousDefaultId, authResult.user.id);

  logPaymentEvent({ level: 'info', operation: 'gatewayManagement', provider: gateway.provider, success: true, message: `Gateway ${id} set as default` });

  return NextResponse.json({ success: true, message: 'تم تعيين البوابة كافتراضية' });
}
