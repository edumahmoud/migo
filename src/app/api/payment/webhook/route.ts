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

    // Try nested order.special_reference, order.merchant_order_id, or order.id
    const order = obj.order;
    if (order && typeof order === 'object') {
      const orderObj = order as Record<string, unknown>;
      // Intention API: order.special_reference
      if (typeof orderObj.special_reference === 'string' && orderObj.special_reference.length > 10) {
        return orderObj.special_reference;
      }
      // Accept API: order.merchant_order_id (our internal UUID)
      if (typeof orderObj.merchant_order_id === 'string' && orderObj.merchant_order_id.length > 10) {
        return orderObj.merchant_order_id;
      }
      // Fallback: order.id (if it looks like a UUID — not Paymob's numeric ID)
      if (typeof orderObj.id === 'string' && orderObj.id.length > 30) {
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

  // ── Top-level diagnostic log ──
  // This confirms the webhook endpoint is being reached by Paymob.
  // If you don't see this log in Vercel after a payment, the webhook
  // URL is NOT configured in Paymob Dashboard.
  console.error(`[webhook:debug] received callback`, {
    provider,
    gatewayIdFromUrl,
    url: request.nextUrl.pathname + request.nextUrl.search,
    method: request.method,
    hasBody: true,
    timestamp: new Date().toISOString(),
  });

  if (!gatewayIdFromUrl && !provider) {
    // Can't identify the caller — reject
    console.error('[webhook:debug] rejecting — missing provider or gateway_id');
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
    console.error('[webhook:debug] calling PaymentService.handleWebhook', {
      resolvedGatewayId,
      rawBodyLength: rawBody.length,
      rawBodyPreview: rawBody.slice(0, 500),
    });
    webhookResult = await PaymentService.handleWebhook(
      { rawBody, headers },
      resolvedGatewayId,
    );
    console.error('[webhook:debug] HMAC verification OK + callback parsed', {
      orderId: webhookResult.orderId,
      status: webhookResult.status,
      amount: webhookResult.amount,
      currency: webhookResult.currency,
      providerTransactionId: webhookResult.providerTransactionId,
    });
  } catch (err) {
    // HMAC failure, gateway not found, gateway disabled, etc.
    console.error('[webhook:debug] HMAC verification OR adapter error', {
      error: err instanceof Error ? err.message : String(err),
      errorCode: isPaymentError(err) ? err.code : 'UNKNOWN',
    });
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
      // ── Multi-subject checkout session fallback (Phase 14) ──
      //
      // The webhookResult.orderId didn't match any order by `id`.
      // It might be a `checkout_session_id` from the multi-subject
      // checkout flow (POST /api/student/checkout/sessions/[id]/pay
      // sets Paymob's special_reference = session_id).
      //
      // Look up all orders WHERE checkout_session_id = orderId.
      // If found, validate + activate each one.
      //
      // Security:
      //   - We do NOT trust webhookResult.orderId as a session_id
      //     without validation. The lookup is parameterized.
      //   - The Paymob HMAC verification already happened inside
      //     PaymentService.handleWebhook (above) — we only reach this
      //     point with a verified callback.
      //   - The amount validation uses SUM(orders.amount) to match
      //     webhookResult.amount (the total Paymob received).
      //   - The currency validation uses the session's currency
      //     (all orders share the same currency — enforced at session
      //     creation in /api/student/checkout/sessions).
      //   - Per-order activation: each order gets its OWN
      //     `provider_payment_id` (`${paymobTxId}:${order.id}`) so
      //     the `payments` UNIQUE(provider_payment_id) constraint
      //     is satisfied AND each order has its own payment row +
      //     financial_ledger entry.
      //   - Idempotency: if the webhook is replayed, the RPC returns
      //     `already_paid` for each order (the RPC's existing
      //     idempotency).
      const { data: sessionOrders, error: sessionErr } = await supabaseServer
        .from('orders')
        .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id')
        .eq('checkout_session_id', webhookResult.orderId);

      if (sessionErr || !sessionOrders || sessionOrders.length === 0) {
        // Not a single order, not a session — give up.
        logPaymentEvent({
          level: 'warn',
          operation: 'handleWebhook',
          provider: webhookResult.provider,
          orderId: webhookResult.orderId,
          success: false,
          errorCode: 'ORDER_NOT_FOUND',
          message: `Order/session not found: ${webhookResult.orderId}`,
          durationMs: Date.now() - startTime,
        });
        return NextResponse.json({ ok: true, ignored: 'order_not_found' });
      }

      // Multi-subject session path
      const sessOrders = sessionOrders as Array<{
        id: string;
        student_id: string;
        subject_id: string;
        amount: number;
        currency: string;
        status: string;
        gateway_id: string | null;
        checkout_session_id: string | null;
      }>;

      // Validate SUM(orders.amount) == webhookResult.amount
      // (Paymob reports the total in major units; convert to cents
      //  for comparison with the per-order amounts).
      const sessionTotal = sessOrders.reduce((sum, o) => sum + Number(o.amount), 0);
      if (webhookResult.amount !== undefined && Math.abs(webhookResult.amount - sessionTotal) > 0.01) {
        logPaymentEvent({
          level: 'error',
          operation: 'handleWebhook',
          provider: webhookResult.provider,
          orderId: webhookResult.orderId,
          success: false,
          errorCode: 'AMOUNT_MISMATCH',
          message: `Session total ${sessionTotal} got ${webhookResult.amount}`,
          durationMs: Date.now() - startTime,
        });
        return NextResponse.json({ ok: true, ignored: 'session_amount_mismatch' });
      }

      // Validate all session orders share the same currency
      const sessionCurrencies = new Set(sessOrders.map((o) => o.currency));
      if (webhookResult.currency && !sessionCurrencies.has(webhookResult.currency)) {
        logPaymentEvent({
          level: 'error',
          operation: 'handleWebhook',
          provider: webhookResult.provider,
          orderId: webhookResult.orderId,
          success: false,
          errorCode: 'CURRENCY_MISMATCH',
          message: `Session currencies ${Array.from(sessionCurrencies).join(',')} got ${webhookResult.currency}`,
          durationMs: Date.now() - startTime,
        });
        return NextResponse.json({ ok: true, ignored: 'session_currency_mismatch' });
      }

      if (webhookResult.status === 'paid') {
        // Activate each order in the session.
        // Use a per-order unique provider_payment_id so the payments
        // table UNIQUE constraint is satisfied and each order has its
        // own payment row + financial_ledger entry.
        const basePaymobTxId = webhookResult.providerTransactionId || `gateway_${randomUUID()}`;
        const activationResults: Array<{ order_id: string; success: boolean; already_paid?: boolean; error?: string }> = [];

        for (const sessOrder of sessOrders) {
          // Idempotency check — skip if already paid
          if (sessOrder.status === 'paid') {
            activationResults.push({ order_id: sessOrder.id, success: true, already_paid: true });
            continue;
          }

          // C12 — Cancelled-Order Race Recovery
          // If the order was cancelled by the teacher BEFORE the webhook
          // arrived, the student has paid on Paymob but the platform
          // flipped the order to 'cancelled'. Atomically flip it back
          // to 'pending' so activation can proceed normally. The RPC
          // is conservative — it returns FALSE for failed/refunded
          // statuses, so those orders are still skipped below.
          if (sessOrder.status === 'cancelled') {
            const perOrderPaymentIdForUncancel = `${basePaymobTxId}:${sessOrder.id}`;
            const { data: uncancelOk, error: uncancelErr } = await supabaseServer.rpc(
              'uncancel_order_if_payment_received',
              {
                p_order_id: sessOrder.id,
                p_provider_payment_id: perOrderPaymentIdForUncancel,
              },
            );

            if (uncancelErr || uncancelOk === false) {
              logPaymentEvent({
                level: 'warn',
                operation: 'handleWebhook',
                provider: webhookResult.provider,
                orderId: sessOrder.id,
                success: false,
                errorCode: 'C12_UNCANCEL_FAILED',
                message: `Order was cancelled; uncancel RPC returned ${uncancelOk} (err=${uncancelErr?.message ?? 'none'})`,
                durationMs: Date.now() - startTime,
              });
              activationResults.push({ order_id: sessOrder.id, success: false, error: `cancelled+uncancel_failed` });
              continue;
            }

            // Uncancel succeeded — flip the local status so the next
            // check lets us proceed with normal activation.
            sessOrder.status = 'pending';

            // Notify the admin about the race condition so they can
            // audit it. Non-blocking, best-effort.
            try {
              const { data: adminUsers } = await supabaseServer
                .from('users')
                .select('id')
                .in('role', ['admin', 'superadmin'])
                .eq('account_status', 'active')
                .limit(10);
              const { notifyUsers } = await import('@/lib/notifications-service');
              const adminIds = (adminUsers ?? []).map((u: { id: string }) => u.id);
              if (adminIds.length > 0) {
                notifyUsers(
                  adminIds,
                  'system',
                  'تنبيه: سباق إلغاء الطلب (C12)',
                  `وصلت webhook دفعة لطلب كان مُلغى (الطالب دفع قبل الإلغاء). تم استعادة الطلب وتفعيل الاشتراك تلقائياً. معرّف الطلب: ${sessOrder.id.slice(0, 8)}…`,
                  '/admin/financial',
                ).catch((err) => {
                  console.warn('[webhook] notifyUsers failed (non-fatal):', err?.message || err);
                });
              }
            } catch (notifyErr) {
              console.warn('[webhook] admin lookup failed (non-fatal):', notifyErr);
            }

            logPaymentEvent({
              level: 'warn',
              operation: 'handleWebhook',
              provider: webhookResult.provider,
              orderId: sessOrder.id,
              success: true,
              errorCode: 'C12_UNCANCEL_OK',
              message: `Order was cancelled but payment confirmed; uncancelled back to pending`,
              durationMs: Date.now() - startTime,
            });
          }

          // Skip non-pending orders (failed/refunded/etc.)
          if (sessOrder.status !== 'pending') {
            activationResults.push({ order_id: sessOrder.id, success: false, error: `status=${sessOrder.status}` });
            continue;
          }

          const perOrderPaymentId = `${basePaymobTxId}:${sessOrder.id}`;
          const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
            'activate_subscription_after_payment',
            {
              p_order_id: sessOrder.id,
              p_provider_payment_id: perOrderPaymentId,
              p_amount: Number(sessOrder.amount),
              p_currency: sessOrder.currency,
              p_status: 'paid',
              p_raw_payload: {
                ...webhookResult.metadata,
                checkout_session_id: webhookResult.orderId,
                session_total: sessionTotal,
                paymob_transaction_id: basePaymobTxId,
              },
              p_confirmed_by: null,
            },
          );

          if (rpcErr) {
            logPaymentEvent({
              level: 'error',
              operation: 'handleWebhook',
              provider: webhookResult.provider,
              orderId: sessOrder.id,
              success: false,
              errorCode: 'RPC_ERROR',
              message: rpcErr.message,
              durationMs: Date.now() - startTime,
            });
            activationResults.push({ order_id: sessOrder.id, success: false, error: rpcErr.message });
            continue;
          }

          const result = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean; already_processed?: boolean }) ?? {};
          activationResults.push({
            order_id: sessOrder.id,
            success: result.success === true,
            already_paid: result.already_paid === true,
            error: result.error,
          });
        }

        logPaymentEvent({
          level: 'info',
          operation: 'handleWebhook',
          provider: webhookResult.provider,
          orderId: webhookResult.orderId,
          paymentReference: webhookResult.paymentReference,
          success: true,
          message: `Session activated ${activationResults.filter(r => r.success).length}/${sessOrders.length} orders`,
          durationMs: Date.now() - startTime,
        });

        return NextResponse.json({
          ok: true,
          success: true,
          session_id: webhookResult.orderId,
          activated_orders: activationResults,
        });
      }

      // Handle failed/cancelled for the session
      if (webhookResult.status === 'failed' || webhookResult.status === 'cancelled') {
        await supabaseServer
          .from('orders')
          .update({ status: webhookResult.status, updated_at: new Date().toISOString() })
          .eq('checkout_session_id', webhookResult.orderId)
          .eq('status', 'pending');

        logPaymentEvent({
          level: 'warn',
          operation: 'handleWebhook',
          provider: webhookResult.provider,
          orderId: webhookResult.orderId,
          success: false,
          message: `Session ${webhookResult.status}`,
          durationMs: Date.now() - startTime,
        });

        return NextResponse.json({ ok: true, status: webhookResult.status });
      }

      // Pending or other — no action
      return NextResponse.json({ ok: true, status: webhookResult.status });
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
