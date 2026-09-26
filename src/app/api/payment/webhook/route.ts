import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';

// Import the payment core (this also registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import { PaymentService, isPaymentError } from '@/lib/payment';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * POST /api/payment/webhook?provider=paymob&gateway_id={gatewayId}
 *
 * Unified webhook endpoint for ALL payment gateway callbacks.
 *
 * Gateway resolution priority (3-tier):
 *   1. gateway_id from URL (highest — from notification_url set by adapter)
 *   2. orders.gateway_id (gateway snapshot — from DB, saved at payment creation)
 *   3. Default Gateway (last resort only — when neither 1 nor 2 exist)
 *
 * This ensures that changing the Default Gateway after a payment is created
 * does NOT affect the webhook for that payment — it uses the original gateway.
 *
 * Flow:
 *   1. Read provider + gateway_id from query params.
 *   2. If gateway_id in URL → use it (Priority 1).
 *   3. If NOT → extract order reference from raw body → look up order →
 *      use orders.gateway_id (Priority 2).
 *   4. If neither → PaymentService falls back to Default Gateway (Priority 3).
 *   5. Call PaymentService.handleWebhook(rawBody, headers, resolvedGatewayId)
 *      → adapter verifies HMAC + parses callback.
 *   6. Validate: order exists, amount matches, currency matches.
 *   7. If status='paid' → call activate_subscription_after_payment RPC.
 *   8. If status='failed' → update order status to 'failed'.
 *
 * Security:
 *   - HMAC verification happens inside the adapter (gateway-specific).
 *   - No retry on HMAC failure — the gateway is determined BEFORE the
 *     handleWebhook call, not after.
 *   - The webhook route does NOT trust the frontend/redirect.
 */

// ─── Order row shape (used in multiple places) ───
interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  gateway_id: string | null;
}

/**
 * Extract the order reference (internal order UUID) from a raw callback body.
 *
 * This is GENERIC — tries common field paths used by payment providers.
 * Not tied to Paymob's specific callback format:
 *   - payload.special_reference (some providers put it at top level)
 *   - payload.obj.special_reference (Paymob transaction callback)
 *   - payload.obj.order.special_reference (nested under order)
 *   - payload.obj.order.id (if it looks like a UUID)
 *   - payload.obj.merchant_order_id (alternative field name)
 *
 * If extraction fails → returns null → webhook falls back to Default Gateway.
 */
function extractOrderReferenceFromCallback(rawBody: string): string | null {
  try {
    const payload = JSON.parse(rawBody);
    const obj = (payload.obj || payload) as Record<string, unknown>;

    // Try special_reference at top level
    if (typeof obj.special_reference === 'string' && obj.special_reference.length > 10) {
      return obj.special_reference;
    }

    // Try nested order.special_reference or order.id
    const order = obj.order;
    if (order && typeof order === 'object') {
      const orderObj = order as Record<string, unknown>;
      if (typeof orderObj.special_reference === 'string' && orderObj.special_reference.length > 10) {
        return orderObj.special_reference;
      }
      if (typeof orderObj.id === 'string' && orderObj.id.length > 30) {
        // Looks like a UUID → use it
        return orderObj.id;
      }
    }

    // Try merchant_order_id
    if (typeof obj.merchant_order_id === 'string' && obj.merchant_order_id.length > 10) {
      return obj.merchant_order_id;
    }

    return null;
  } catch {
    // Not valid JSON or unexpected structure
    return null;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // 1. Read provider + gateway_id from query params
  const provider = request.nextUrl.searchParams.get('provider');
  const gatewayIdFromUrl = request.nextUrl.searchParams.get('gateway_id');

  if (!gatewayIdFromUrl && !provider) {
    // Can't identify the caller — reject
    return NextResponse.json(
      { success: false, error: 'Missing provider or gateway_id query parameter' },
      { status: 400 },
    );
  }

  // 2. Read the raw body (for HMAC verification + order reference extraction)
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // 3. Determine which gateway to use — 3-tier resolution:
  //    Priority 1: gateway_id from URL
  //    Priority 2: orders.gateway_id (gateway snapshot from DB)
  //    Priority 3: Default Gateway (last resort — PaymentService handles this)
  let resolvedGatewayId: string | undefined = gatewayIdFromUrl || undefined;

  // If no gateway_id from URL → try to find it from the order
  let preResolvedOrder: OrderRow | null = null;

  if (!resolvedGatewayId) {
    // Priority 2: extract order reference from raw body → look up order →
    // use its saved gateway_id. This is the gateway snapshot.
    const orderRef = extractOrderReferenceFromCallback(rawBody);
    if (orderRef) {
      const { data: order } = await supabaseServer
        .from('orders')
        .select('id, student_id, subject_id, amount, currency, status, gateway_id')
        .eq('id', orderRef)
        .maybeSingle();

      if (order) {
        preResolvedOrder = order as OrderRow;
        if (preResolvedOrder.gateway_id) {
          // Use the order's saved gateway_id — this ensures the webhook
          // uses the SAME gateway that created the payment, even if the
          // default changed since then.
          resolvedGatewayId = preResolvedOrder.gateway_id;

          logPaymentEvent({
            level: 'info',
            operation: 'handleWebhook',
            provider: provider || undefined,
            orderId: preResolvedOrder.id,
            success: true,
            message: `Gateway resolved from orders.gateway_id (snapshot): ${resolvedGatewayId}`,
          });
        }
        // If orders.gateway_id is null → resolvedGatewayId stays undefined
        // → PaymentService will use the default gateway (Priority 3, last resort)
      }
    }
  }

  // 4. Call PaymentService.handleWebhook → adapter verifies HMAC + parses
  //    PaymentService.resolveAdapter() handles:
  //      - resolvedGatewayId set → resolveGatewayById() (Priority 1 or 2)
  //      - resolvedGatewayId undefined → resolveDefaultGateway() (Priority 3)
  let webhookResult;
  try {
    webhookResult = await PaymentService.handleWebhook(
      { rawBody, headers },
      resolvedGatewayId,
    );
  } catch (err) {
    // HMAC failure, gateway not found, gateway disabled, etc.
    logPaymentEvent({
      level: 'error',
      operation: 'handleWebhook',
      provider: provider || undefined,
      orderId: preResolvedOrder?.id,
      success: false,
      errorCode: isPaymentError(err) ? err.code : 'UNKNOWN',
      message: err instanceof Error ? err.message : 'unknown error',
      durationMs: Date.now() - startTime,
    });

    // Return 200 to prevent retries on verification failure
    return NextResponse.json({ ok: true, ignored: 'verification_failed' });
  }

  // 5. Get the order (reuse pre-resolved if available, otherwise look up)
  let o: OrderRow | null = preResolvedOrder;

  if (!o) {
    // No pre-resolved order → look up by webhookResult.orderId
    if (!webhookResult.orderId) {
      logPaymentEvent({
        level: 'warn',
        operation: 'handleWebhook',
        provider: webhookResult.provider,
        success: false,
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Callback has no orderId (special_reference missing)',
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ ok: true, ignored: 'no_order_ref' });
    }

    const { data: order, error: orderErr } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, currency, status, gateway_id')
      .eq('id', webhookResult.orderId)
      .maybeSingle();

    if (orderErr || !order) {
      logPaymentEvent({
        level: 'warn',
        operation: 'handleWebhook',
        provider: webhookResult.provider,
        orderId: webhookResult.orderId,
        success: false,
        errorCode: 'ORDER_NOT_FOUND',
        message: `Order not found: ${webhookResult.orderId}`,
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ ok: true, ignored: 'order_not_found' });
    }

    o = order as OrderRow;
  }

  // 6. Validate amount + currency match the internal order
  if (webhookResult.amount !== undefined && Math.abs(webhookResult.amount - Number(o.amount)) > 0.01) {
    logPaymentEvent({
      level: 'error',
      operation: 'handleWebhook',
      provider: webhookResult.provider,
      orderId: o.id,
      success: false,
      errorCode: 'AMOUNT_MISMATCH',
      message: `Expected ${o.amount} got ${webhookResult.amount}`,
      durationMs: Date.now() - startTime,
    });
    return NextResponse.json({ ok: true, ignored: 'amount_mismatch' });
  }

  if (webhookResult.currency && webhookResult.currency !== o.currency) {
    logPaymentEvent({
      level: 'error',
      operation: 'handleWebhook',
      provider: webhookResult.provider,
      orderId: o.id,
      success: false,
      errorCode: 'CURRENCY_MISMATCH',
      message: `Expected ${o.currency} got ${webhookResult.currency}`,
      durationMs: Date.now() - startTime,
    });
    return NextResponse.json({ ok: true, ignored: 'currency_mismatch' });
  }

  // 7. Handle the payment status
  if (webhookResult.status === 'paid') {
    // Check if already paid (idempotency — the RPC handles this too)
    if (o.status === 'paid') {
      logPaymentEvent({
        level: 'info',
        operation: 'handleWebhook',
        provider: webhookResult.provider,
        orderId: o.id,
        success: true,
        errorCode: 'ALREADY_PAID',
        message: 'Order already paid — idempotent success',
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ ok: true, already_paid: true });
    }

    // Call the existing RPC — atomic + idempotent
    const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
      'activate_subscription_after_payment',
      {
        p_order_id: o.id,
        p_provider_payment_id: webhookResult.providerTransactionId || `gateway_${randomUUID()}`,
        p_amount: Number(o.amount),
        p_currency: o.currency,
        p_status: 'paid',
        p_raw_payload: webhookResult.metadata || {},
        p_confirmed_by: null,
      },
    );

    if (rpcErr) {
      logPaymentEvent({
        level: 'error',
        operation: 'handleWebhook',
        provider: webhookResult.provider,
        orderId: o.id,
        success: false,
        errorCode: 'RPC_ERROR',
        message: rpcErr.message,
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ ok: true, error: 'rpc_failed' });
    }

    const result = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
    logPaymentEvent({
      level: 'info',
      operation: 'handleWebhook',
      provider: webhookResult.provider,
      orderId: o.id,
      paymentReference: webhookResult.paymentReference,
      success: true,
      message: result.already_paid ? 'Already paid (idempotent)' : 'Subscription activated',
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ ok: true, success: true });
  }

  // Handle failed/cancelled status
  if (webhookResult.status === 'failed' || webhookResult.status === 'cancelled') {
    await supabaseServer
      .from('orders')
      .update({ status: webhookResult.status, updated_at: new Date().toISOString() })
      .eq('id', o.id)
      .eq('status', 'pending');

    logPaymentEvent({
      level: 'warn',
      operation: 'handleWebhook',
      provider: webhookResult.provider,
      orderId: o.id,
      success: false,
      message: `Payment ${webhookResult.status}`,
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ ok: true, status: webhookResult.status });
  }

  // Pending or other status — no action
  return NextResponse.json({ ok: true, status: webhookResult.status });
}
