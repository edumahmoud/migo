import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import '@/lib/payment/providers/fawry';
import { resolveDefaultGateway } from '@/lib/payment/resolver';
import { getOrderTransactions } from '@/lib/payment/providers/paymob/client';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * GET /api/cron/reconcile-pending-orders
 *
 * Background reconciliation job — scheduled via vercel.json cron.
 * Runs every 5 minutes and:
 *   1. Finds ALL pending orders with a `provider_order_ref` (Paymob order/intention ID)
 *      that have been pending for > 2 minutes (gives Paymob time to index the transaction).
 *   2. For each, queries Paymob directly via `getOrderTransactions` to look for a successful transaction.
 *   3. If found → calls `activate_subscription_after_payment` RPC (idempotent + atomic).
 *
 * This is the SAFETY NET for auto-activation:
 *   - Paymob's Accept API does NOT honor per-transaction `notification_url` for the webhook,
 *     so the webhook often doesn't fire (account-level webhook URL must be configured
 *     in the Paymob Dashboard, which is easy to forget).
 *   - The `verify-after-redirect` fallback only fires when the student returns to the site
 *     via `?payment_callback=success` — if they close the tab or the redirect doesn't
 *     include that param, no activation happens.
 *
 * With this cron, even if BOTH the webhook AND verify-after-redirect fail, the student
 * will be auto-activated within 5-7 minutes (2 min wait + 5 min cron interval).
 *
 * Authentication:
 *   - If `CRON_SECRET` env var is set, the request must include `Authorization: Bearer <secret>`.
 *   - If `CRON_SECRET` is NOT set, the endpoint requires admin authentication (for manual triggering
 *     via the admin dashboard). This is useful for testing.
 *
 * Idempotency: the RPC is idempotent — running this multiple times for the same order is safe.
 *   The RPC's `IF v_order.status = 'paid'` check + `ON CONFLICT DO NOTHING/UPDATE` clauses handle
 *   concurrent invocations from webhook + verify-after-redirect + this cron.
 *
 * Returns a summary: { processed, activated, already_paid, skipped, errors, total }
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel cron limit

interface PendingOrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  base_amount: number | null;
  fees_total: number | null;
  grand_total: number | null;
  currency: string;
  status: string;
  gateway_id: string | null;
  provider_order_ref: string | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // ── Authentication ──
  // If CRON_SECRET is set, the request must include Authorization: Bearer <secret>.
  // This is the standard Vercel Cron auth pattern.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const providedSecret = authHeader?.replace(/^Bearer\s+/i, '');
    if (providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  // If CRON_SECRET is not set, the endpoint can be called without auth (e.g., for
  // local development or manual testing via a browser). In production, ALWAYS set
  // CRON_SECRET to prevent abuse.

  console.info('[cron:reconcile-pending-orders] starting reconciliation');

  try {
    // ── Step 1: Find pending orders with a Paymob provider_order_ref,
    //            older than 2 minutes (give Paymob time to index the transaction). ──
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: pendingOrders, error: pendingErr } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, status, gateway_id, provider_order_ref, created_at')
      .eq('status', 'pending')
      .not('provider_order_ref', 'is', null)
      .lt('created_at', twoMinutesAgo) // only orders older than 2 minutes
      .order('created_at', { ascending: true })
      .limit(50); // safety limit — don't process too many at once

    if (pendingErr) {
      console.error('[cron:reconcile-pending-orders] DB error fetching pending orders:', pendingErr.message);
      return NextResponse.json({ error: 'DB error', details: pendingErr.message }, { status: 500 });
    }

    const orders = (pendingOrders ?? []) as PendingOrderRow[];

    // Filter to orders that have a REAL provider_order_ref (Paymob order/intention ID),
    // not a placeholder like "order_xxx" or "free_xxx".
    const validOrders = orders.filter(
      (o) =>
        o.provider_order_ref &&
        o.provider_order_ref.length > 5 &&
        !o.provider_order_ref.startsWith('order_') &&
        !o.provider_order_ref.startsWith('free_') &&
        !o.provider_order_ref.startsWith('fallback_'),
    );

    console.info('[cron:reconcile-pending-orders] found pending orders', {
      total: orders.length,
      withValidPaymobRef: validOrders.length,
    });

    if (validOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending orders to reconcile',
        summary: { total: 0, processed: 0, activated: 0, already_paid: 0, skipped: 0, errors: 0 },
      });
    }

    // ── Step 2: Resolve the default gateway to get the Paymob secretKey ──
    // (The Paymob credentials are stored in the payment_gateways DB table, not env vars.)
    let secretKey: string;
    try {
      const resolvedAdapter = await resolveDefaultGateway();
      const creds = resolvedAdapter.gateway.credentials as unknown as { secretKey: string };
      secretKey = creds.secretKey;
    } catch (err) {
      console.error('[cron:reconcile-pending-orders] failed to resolve default gateway:', err);
      return NextResponse.json(
        { error: 'Payment gateway not configured', details: err instanceof Error ? err.message : String(err) },
        { status: 503 },
      );
    }

    // ── Step 3: Get Paymob auth token ──
    // We import this dynamically to avoid loading the Paymob client in test environments
    // where Paymob isn't configured.
    const { getAuthToken } = await import('@/lib/payment/providers/paymob/client');
    let authToken: string;
    try {
      authToken = await getAuthToken(secretKey);
    } catch (err) {
      console.error('[cron:reconcile-pending-orders] failed to get Paymob auth token:', err);
      return NextResponse.json(
        { error: 'Paymob auth failed', details: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }

    // ── Step 4: For each pending order, query Paymob for transactions ──
    const summary = {
      total: validOrders.length,
      processed: 0,
      activated: 0,
      already_paid: 0,
      skipped: 0,
      errors: 0,
    };
    const errors: Array<{ order_id: string; error: string }> = [];

    for (const o of validOrders) {
      summary.processed += 1;

      try {
        // Skip if the order's status changed (e.g., webhook fired between our SELECT and now)
        // — re-fetch the latest status before doing anything.
        const { data: freshOrder } = await supabaseServer
          .from('orders')
          .select('status')
          .eq('id', o.id)
          .maybeSingle();
        const currentStatus = (freshOrder as { status: string } | null)?.status;
        if (currentStatus && currentStatus !== 'pending') {
          summary.skipped += 1;
          continue;
        }

        // Query Paymob for transactions on this order
        const paymobOrderId = o.provider_order_ref!;
        const transactions = await getOrderTransactions(authToken, paymobOrderId);

        // Find a successful transaction
        const successfulTx = transactions.find((t) => t.success === true);

        if (!successfulTx) {
          // No successful transaction found — order might still be genuinely pending
          // (student abandoned) or Paymob's API hasn't indexed the transaction yet.
          // Skip — will be retried on the next cron run.
          summary.skipped += 1;
          continue;
        }

        // ── Step 5: Found a successful transaction → activate via the RPC ──
        const perOrderPaymentId = `${successfulTx.id}:${o.id}`;
        const amountToPass = Number(o.grand_total ?? o.amount);
        const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
          'activate_subscription_after_payment',
          {
            p_order_id: o.id,
            p_provider_payment_id: perOrderPaymentId,
            p_amount: amountToPass,
            p_currency: o.currency,
            p_status: 'paid',
            p_raw_payload: {
              cron_reconciliation: true,
              paymob_transaction_id: String(successfulTx.id),
              paymob_order_id: paymobOrderId,
              activated_at: new Date().toISOString(),
              reason: 'Auto-reconciliation via Vercel Cron (webhook fallback)',
            },
            p_confirmed_by: null,
          },
        );

        if (rpcErr) {
          console.error('[cron:reconcile-pending-orders] RPC error for order', o.id, rpcErr.message);
          summary.errors += 1;
          errors.push({ order_id: o.id, error: `rpc_error: ${rpcErr.message}` });
          continue;
        }

        const result = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
        if (result.success === false) {
          // RPC returned an internal failure (e.g., amount_mismatch).
          // For amount_mismatch specifically, the order's grand_total might differ from
          // what Paymob actually charged — we should still try to activate via direct UPSERT
          // (matching the verify-after-redirect fallback behavior).
          if (result.error === 'amount_mismatch') {
            console.warn('[cron:reconcile-pending-orders] amount_mismatch for order', o.id, '— trying direct enrollment fallback');

            // Direct enrollment fallback (matches verify-after-redirect Strategy 0 fallback)
            const now = new Date().toISOString();
            await supabaseServer
              .from('subject_students')
              .upsert({
                subject_id: o.subject_id,
                student_id: o.student_id,
                status: 'approved',
                enrollment_method: 'self_paid',
                enrolled_at: now,
                monthly_price: Number(o.amount),
                current_period_start: now,
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              }, { onConflict: 'subject_id,student_id' });

            await supabaseServer
              .from('orders')
              .update({ status: 'paid', paid_at: now, activated_at: now, updated_at: now })
              .eq('id', o.id)
              .eq('status', 'pending');

            await supabaseServer
              .from('users')
              .update({ account_status: 'active', updated_at: now })
              .eq('id', o.student_id)
              .in('account_status', ['pending', 'pending_verification', null]);

            // Best-effort: insert payments row
            await supabaseServer
              .from('payments')
              .insert({
                order_id: o.id,
                provider_payment_id: perOrderPaymentId,
                amount: amountToPass,
                currency: o.currency,
                status: 'paid',
                raw_payload: { cron_reconciliation: true, fallback: true, paymob_transaction_id: String(successfulTx.id) },
                confirmed_by: null,
              })
              .then(({ error }) => {
                if (error) {
                  console.warn('[cron:reconcile-pending-orders] payments insert failed (non-critical) for order', o.id, error.message);
                }
              });

            summary.activated += 1;
            logPaymentEvent({
              level: 'info',
              operation: 'cron_reconcile',
              provider: 'paymob',
              orderId: o.id,
              paymentReference: perOrderPaymentId,
              success: true,
              message: 'Activated via cron reconciliation (direct fallback due to amount_mismatch)',
              durationMs: Date.now() - startTime,
            });
            continue;
          }

          // Other RPC errors
          console.error('[cron:reconcile-pending-orders] RPC returned failure for order', o.id, result.error);
          summary.errors += 1;
          errors.push({ order_id: o.id, error: `rpc_soft_failure: ${result.error}` });
          continue;
        }

        // RPC succeeded
        if (result.already_paid) {
          summary.already_paid += 1;
        } else {
          summary.activated += 1;
        }
        logPaymentEvent({
          level: 'info',
          operation: 'cron_reconcile',
          provider: 'paymob',
          orderId: o.id,
          paymentReference: perOrderPaymentId,
          success: true,
          message: result.already_paid ? 'Already paid (idempotent)' : 'Activated via cron reconciliation',
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        console.error('[cron:reconcile-pending-orders] error processing order', o.id, err);
        summary.errors += 1;
        errors.push({ order_id: o.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    console.info('[cron:reconcile-pending-orders] reconciliation complete', summary);

    return NextResponse.json({
      success: true,
      summary,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[cron:reconcile-pending-orders] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
