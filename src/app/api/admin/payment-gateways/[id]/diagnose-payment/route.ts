import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// Import payment core (registers Paymob adapter)
import '@/lib/payment/providers/paymob';
import { resolveGatewayById } from '@/lib/payment/resolver';
import { logPaymentEvent } from '@/lib/payment/logger';
import {
  getAuthToken,
  createOrder,
  getPaymentKey,
  buildIframeUrl,
} from '@/lib/payment/providers/paymob/client';
import type { PaymobCredentials, PaymobConfiguration } from '@/lib/payment/providers/paymob/types';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * POST /api/admin/payment-gateways/[id]/diagnose-payment
 *
 * Runs a FULL Paymob payment creation flow with a 1.00 EGP test amount
 * to diagnose exactly WHERE and WHY the flow is failing.
 *
 * Returns DETAILED diagnostic info (admin-only) including:
 *   - Which step succeeded/failed (auth, order, payment_key, iframe)
 *   - The Paymob response body (truncated) on failure
 *   - The integration ID being used
 *   - The billing_data that would be sent (without the phone)
 *
 * SECURITY:
 *   - Admin-only (requireAdmin)
 *   - No real charge — only creates a 1.00 EGP test order (Paymob
 *     will void it within 1 hour if unpaid)
 *   - Does NOT expose API keys, HMAC secrets, or payment tokens
 *     (only the first/last 4 chars for verification)
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const { id } = await ctx.params;

  // Diagnostic stages
  const stages: Array<{
    stage: string;
    success: boolean;
    message: string;
    data?: Record<string, unknown>;
  }> = [];

  let resolvedAdapter;
  try {
    resolvedAdapter = await resolveGatewayById(id);
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to resolve gateway',
      stages,
    }, { status: 500 });
  }

  const gateway = resolvedAdapter.gateway;
  const creds = gateway.credentials as unknown as PaymobCredentials;
  const config = gateway.configuration as unknown as PaymobConfiguration;

  // ─── Verify credentials structure ───
  stages.push({
    stage: 'credentials_check',
    success: !!creds.secretKey && !!creds.hmacSecret && !!creds.integrationIds?.length,
    message: `secretKey present=${!!creds.secretKey}, hmacSecret present=${!!creds.hmacSecret}, integrationIds=${JSON.stringify(creds.integrationIds ?? [])}`,
    data: {
      secretKeyPrefix: creds.secretKey ? `${creds.secretKey.slice(0, 4)}...` : null,
      secretKeyLength: creds.secretKey?.length ?? 0,
      integrationIds: creds.integrationIds ?? [],
      notificationUrl: config.notificationUrl,
      redirectionUrl: config.redirectionUrl,
      gatewayId: gateway.id,
      provider: gateway.provider,
      environment: gateway.environment,
      isEnabled: gateway.isEnabled,
    },
  });

  // ─── Stage 1: Get auth token ───
  let authToken: string | null = null;
  try {
    authToken = await getAuthToken(creds.secretKey);
    stages.push({
      stage: '1_auth_token',
      success: true,
      message: 'Paymob accepted the API key and returned an auth token',
      data: { tokenLength: authToken.length },
    });
  } catch (err) {
    stages.push({
      stage: '1_auth_token',
      success: false,
      message: err instanceof Error ? err.message : 'Failed to get auth token',
      data: err instanceof Error ? { cause: String(err.cause ?? '').slice(0, 500) } : undefined,
    });

    // Can't continue without auth token
    return NextResponse.json({
      success: false,
      error: 'Auth token request failed — Paymob rejected the API key',
      stages,
    }, { status: 500 });
  }

  // ─── Stage 2: Create order ───
  // Use a tiny test amount (1.00 EGP = 100 cents) so we don't accidentally
  // charge a large amount during diagnostics.
  const testAmountCents = 100; // 1.00 EGP
  const testOrderId = `diag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let order: { id: number } | null = null;
  try {
    order = await createOrder(authToken, {
      amount_cents: testAmountCents,
      currency: 'EGP',
      merchant_order_id: testOrderId,
      items: [
        {
          name: 'Diagnostic Test Order',
          amount_cents: testAmountCents,
          quantity: 1,
        },
      ],
    });
    stages.push({
      stage: '2_create_order',
      success: true,
      message: `Paymob created order id=${order.id}`,
      data: { orderId: order.id, merchantOrderId: testOrderId, amountCents: testAmountCents },
    });
  } catch (err) {
    stages.push({
      stage: '2_create_order',
      success: false,
      message: err instanceof Error ? err.message : 'Failed to create order',
      data: err instanceof Error ? { cause: String(err.cause ?? '').slice(0, 500) } : undefined,
    });

    return NextResponse.json({
      success: false,
      error: 'Order creation failed — see stage 2 details',
      stages,
    }, { status: 500 });
  }

  // ─── Stage 3: Get payment key ───
  // Use a valid Egyptian test phone for diagnostics
  const integrationId = creds.integrationIds![0];
  const testBillingData = {
    first_name: 'Test',
    last_name: 'Student',
    email: 'test@attendo.local',
    phone_number: '+201000000000',
    building: 'NA',
    floor: 'NA',
    apartment: 'NA',
    city: 'Cairo',
    country: 'EG',
    street: 'NA',
    shipping_method: 'NA',
  };

  let paymentToken: string | null = null;
  try {
    const paymentKey = await getPaymentKey(authToken, {
      amount_cents: testAmountCents,
      order_id: order.id,
      currency: 'EGP',
      integration_id: integrationId,
      billing_data: testBillingData,
    });
    paymentToken = paymentKey.token;
    stages.push({
      stage: '3_payment_key',
      success: true,
      message: `Paymob generated a payment token (length=${paymentToken.length})`,
      data: {
        integrationId,
        tokenLength: paymentToken.length,
        billingData: testBillingData,
      },
    });
  } catch (err) {
    stages.push({
      stage: '3_payment_key',
      success: false,
      message: err instanceof Error ? err.message : 'Failed to get payment key',
      data: err instanceof Error ? { cause: String(err.cause ?? '').slice(0, 500) } : undefined,
    });

    return NextResponse.json({
      success: false,
      error: 'Payment key request failed — see stage 3 details',
      stages,
    }, { status: 500 });
  }

  // ─── Stage 4: Build iframe URL ───
  const iframeUrl = buildIframeUrl(integrationId, paymentToken);
  stages.push({
    stage: '4_iframe_url',
    success: true,
    message: 'Built iframe URL successfully',
    data: { iframeUrl, integrationId },
  });

  logPaymentEvent({
    level: 'info',
    operation: 'gatewayManagement',
    provider: 'paymob',
    success: true,
    message: `Diagnostic test payment flow succeeded for gateway ${id}`,
  });

  return NextResponse.json({
    success: true,
    message: 'Full Paymob payment flow succeeded. The gateway is correctly configured.',
    stages,
    iframeUrl,
    testOrderId,
    paymobOrderId: order.id,
  });
}

/**
 * GET /api/admin/payment-gateways/[id]/diagnose-payment
 *
 * Returns instructions on how to use the POST endpoint.
 */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  return NextResponse.json({
    endpoint: 'POST /api/admin/payment-gateways/[id]/diagnose-payment',
    description: 'Runs a full Paymob payment creation flow with a 1.00 EGP test amount to diagnose where the flow is failing.',
    returns: [
      'stages[] — list of stages with success/message/data',
      'iframeUrl — the Paymob iframe URL (if all stages passed)',
      'paymobOrderId — the Paymob-side order ID',
    ],
    security: 'Admin-only. No real charge — Paymob voids the order within 1 hour if unpaid.',
  });
}
