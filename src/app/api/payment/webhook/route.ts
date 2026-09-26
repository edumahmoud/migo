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
 * Flow:
 *   1. Read `provider` and `gateway_id` from query params.
 *   2. If `gateway_id` is provided → resolve that specific gateway
 *      (uses the gateway snapshot — even if the default changed since
 *      the payment was created).
 *   3. If only `provider` is provided → resolve the default gateway
 *      for that provider.
 *   4. If neither is provided → reject (can't identify the caller).
 *   5. Call PaymentService.handleWebhook(rawBody, headers, gatewayId)
 *      → the adapter verifies HMAC + parses the callback.
 *   6. The webhook validates: order exists, amount matches, currency matches.
 *   7. If status='paid' → call activate_subscription_after_payment RPC
 *      (existing, unchanged — atomic + idempotent).
 *   8. If status='failed' → update order status to 'failed'.
 *
 * Security:
 *   - HMAC verification happens inside the adapter (gateway-specific).
 *   - No global PAYMENT_WEBHOOK_SECRET for Paymob — Paymob HMAC uses
 *     the gateway's stored hmacSecret (encrypted in DB).
 *   - The webhook route does NOT trust the frontend/redirect.
 *   - The webhook route does NOT call the RPC directly for failed/pending
 *     callbacks — only for verified 'paid' callbacks.
 *
 * Phase 3 note:
 *   The old global PAYMENT_WEBHOOK_SECRET (used by the deleted mock gateway)
 *   has been removed. Paymob callbacks use the per-gateway hmacSecret.
 */

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // 1. Read provider + gateway_id from query params
  const provider = request.nextUrl.searchParams.get('provider');
  const gatewayId = request.nextUrl.searchParams.get('gateway_id');

  if (!gatewayId && !provider) {
    // Can't identify the caller — reject
    return NextResponse.json(
      { success: false, error: 'Missing provider or gateway_id query parameter' },
      { status: 400 },
    );
  }

  // 2. Read the raw body (for HMAC verification by the adapter)
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // 3. Call PaymentService.handleWebhook → adapter verifies HMAC + parses
  let webhookResult;
  try {
    webhookResult = await PaymentService.handleWebhook(
      { rawBody, headers },
      gatewayId || undefined,
    );
  } catch (err) {
    // HMAC failure, gateway not found, gateway disabled, etc.
    logPaymentEvent({
      level: 'error',
      operation: 'handleWebhook',
      provider: provider || undefined,
      success: false,
      errorCode: isPaymentError(err) ? err.code : 'UNKNOWN',
      message: err instanceof Error ? err.message : 'unknown error',
      durationMs: Date.now() - startTime,
    });

    // Return 200 to prevent Paymob from retrying on verification failure
    // (security: don't reveal the error to the caller)
    return NextResponse.json({ ok: true, ignored: 'verification_failed' });
  }

  // 4. Validate the order exists + amount + currency match
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

  // Look up the order by the internal order ID (from special_reference)
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

  const o = order as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number;
    currency: string;
    status: string;
    gateway_id: string | null;
  };

  // 5. Validate amount + currency match the internal order
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

  // 6. Handle the payment status
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
    // The RPC: INSERTs payment → UPDATEs order='paid' → UPSERTs enrollment → activates student
    const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
      'activate_subscription_after_payment',
      {
        p_order_id: o.id,
        p_provider_payment_id: webhookResult.providerTransactionId || `paymob_${randomUUID()}`,
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
