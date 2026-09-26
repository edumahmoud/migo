import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// Import payment core (registers Paymob adapter)
import '@/lib/payment/providers/paymob';
import { PaymentService, isPaymentError } from '@/lib/payment';
import { auditGatewayConnectionTested } from '@/lib/payment/audit';
import { logPaymentEvent } from '@/lib/payment/logger';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/payment-gateways/[id]/test-connection
 *
 * Tests the connection to a payment gateway using the adapter's
 * testConnection() method. Delegates entirely to PaymentService —
 * no provider-specific logic here.
 *
 * Returns:
 *   - success: true/false
 *   - message: safe, short description (no credentials/secrets)
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  try {
    const result = await PaymentService.testConnection(id);

    await auditGatewayConnectionTested(id, result.success, result.message, authResult.user.id);

    logPaymentEvent({
      level: result.success ? 'info' : 'warn',
      operation: 'gatewayManagement',
      provider: result.provider,
      success: result.success,
      message: `Connection test: ${result.message}`,
    });

    return NextResponse.json({
      success: result.success,
      message: result.message,
      testedAt: result.testedAt,
    });
  } catch (err) {
    const message = isPaymentError(err) ? err.message : (err instanceof Error ? err.message : 'فشل اختبار الاتصال');

    logPaymentEvent({
      level: 'error',
      operation: 'gatewayManagement',
      success: false,
      message: `Connection test failed: ${message}`,
    });

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
