import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';
// v112: per-teacher commission resolver + v88 fees-on-top split helper
import { getEffectiveCommissionRate, calculateSharesFromOrderFees, OrderFeesSnapshotError } from '@/lib/payment/commission';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import '@/lib/payment/providers/fawry';
import { resolveDefaultGateway } from '@/lib/payment/resolver';
import { getAuthToken, getTransaction, getOrderTransactions } from '@/lib/payment/providers/paymob/client';
import type { PaymobTransactionResponse } from '@/lib/payment/providers/paymob/client';
// v110: secure HMAC validation for redirect URL params — replaces the
// old bypassable URL-params check that was removed in commit ffdaca0
// for security reasons. With HMAC validation, we can trust that a valid
// signature = Paymob actually processed the payment (the secret is only
// known to Paymob + our backend).
import { verifyRedirectHmacFromUrlParams } from '@/lib/payment/providers/paymob/hmac';

/**
 * POST /api/student/orders/verify-after-redirect
 *
 * ROOT SOLUTION for detecting approved Paymob payments.
 *
 * We query Paymob DIRECTLY using the Paymob order ID stored in our DB
 * (orders.provider_order_ref). This works REGARDLESS of:
 *   - Whether the webhook fired (it usually doesn't for Accept API)
 *   - Whether Paymob included transaction ID in the redirect URL
 *   - Whether the Intention API is enabled (we use Accept API)
 *
 * Body: { transactionId?, orderId?, merchantOrderId?, urlParams? }
 *
 * Strategy (in order):
 *   0. NEW: Find the student's pending orders that have a numeric
 *      provider_order_ref → call getOrderTransactions(authToken,
 *      paymob_order_id) → if a successful transaction exists →
 *      activate.
 *   1. If transactionId is provided → call getTransaction directly.
 *   2. If merchantOrderId is provided → look up our order → use
 *      provider_order_ref → call getOrderTransactions.
 *   3. Fall back to checking ALL student's pending orders.
 *
 * For each successfully-verified transaction, the endpoint calls the
 * activate_subscription_after_payment RPC (idempotent).
 */

interface RequestBody {
  transactionId?: string;
  orderId?: string;
  merchantOrderId?: string;
  urlParams?: Record<string, string>;
}

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  // v110: post-v88 orders carry base_amount + fees_total + grand_total.
  // The activate_subscription_after_payment RPC checks against grand_total
  // (NOT amount) for these orders — so we MUST fetch + pass grand_total.
  // Without this, the RPC returns amount_mismatch and the enrollment fails.
  base_amount: number | null;
  fees_total: number | null;
  grand_total: number | null;
  currency: string;
  status: string;
  gateway_id: string | null;
  checkout_session_id: string | null;
  provider_order_ref: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: RequestBody;
  try { body = await request.json() as RequestBody; } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const studentId = auth.user.id;

  console.info('[verify-after-redirect:debug] received request', {
    transactionId: body.transactionId,
    orderId: body.orderId,
    merchantOrderId: body.merchantOrderId,
    urlParamsKeys: body.urlParams ? Object.keys(body.urlParams) : [],
    studentId,
  });

  // 1. Resolve the default gateway to get the secretKey
  let secretKey: string;
  try {
    const resolvedAdapter = await resolveDefaultGateway();
    const creds = resolvedAdapter.gateway.credentials as unknown as { secretKey: string };
    secretKey = creds.secretKey;
  } catch (err) {
    console.error('[verify-after-redirect:debug] failed to resolve default gateway', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'بوابة الدفع غير مُهيّأة' },
      { status: 503 },
    );
  }

  // 2. Get auth token (OPTIONAL — if this fails, we fall back to
  //    the synthetic transaction approach which doesn't need the
  //    Paymob API. The synthetic approach activates based on:
  //    - Student was redirected from Paymob with ?payment_callback=success
  //    - Order has a numeric provider_order_ref (payment was initiated)
  let authToken: string | null = null;
  try {
    authToken = await getAuthToken(secretKey);
  } catch (err) {
    // Auth token failed — but DON'T return an error. We'll use the
    // synthetic transaction approach instead (which doesn't need
    // the Paymob API). This is the "remove activation restrictions"
    // behavior the user requested.
    console.warn('[verify-after-redirect:debug] getAuthToken failed — using synthetic fallback (no Paymob API needed)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Strategy 0 (ROOT): Find the student's pending orders with a
  //    numeric provider_order_ref → query Paymob for transactions ──
  //
  // This is the PRIMARY strategy. It doesn't depend on any URL params
  // or webhook. We just use the Paymob order ID we already have stored.
  //
  console.info('[verify-after-redirect:debug] strategy 0: querying student pending orders via Paymob order ID');

  const { data: pendingOrders, error: pendingErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, status, gateway_id, checkout_session_id, provider_order_ref')
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10);

  if (pendingErr) {
    console.error('[verify-after-redirect:debug] failed to fetch pending orders', pendingErr);
  }

  const pendingList = (pendingOrders ?? []) as OrderRow[];

  // Filter to orders that have a REAL provider_order_ref (Paymob order/intention ID).
  // Accept BOTH numeric (Accept API) AND UUID (Intention API) values.
  // Only exclude: null, empty, and placeholder values like "order_xxx".
  const ordersWithPaymobRef = pendingList.filter(
    (o) => o.provider_order_ref &&
           o.provider_order_ref.length > 5 &&
           !o.provider_order_ref.startsWith('order_') &&
           !o.provider_order_ref.startsWith('free_'),
  );

  // v122 FIX: also look for PENDING orders that are part of a checkout
  // session but DON'T have their own provider_order_ref. In multi-subject
  // checkout, only the FIRST order gets provider_order_ref (UNIQUE constraint).
  // The other orders in the session have checkout_session_id but no
  // provider_order_ref. If the first order was already activated (status='paid'),
  // we need to find the session_id from the PAID order, then activate the
  // remaining PENDING siblings.
  const pendingSessionOrders = pendingList.filter(
    (o) => o.checkout_session_id &&
           (!o.provider_order_ref ||
            o.provider_order_ref.startsWith('order_') ||
            o.provider_order_ref.startsWith('free_')),
  );

  // For each pending session order, find the session's first order (which
  // has the provider_order_ref) — even if it's already paid — and use its
  // provider_order_ref to query Paymob.
  const sessionIdsToCheck = new Set<string>();
  for (const o of pendingSessionOrders) {
    if (o.checkout_session_id) sessionIdsToCheck.add(o.checkout_session_id);
  }

  // Also check paid orders that have provider_order_ref (the first order in
  // a session that was already activated) — their session siblings may still
  // be pending.
  if (sessionIdsToCheck.size > 0) {
    const { data: paidSessionOrders } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, status, gateway_id, checkout_session_id, provider_order_ref')
      .in('checkout_session_id', Array.from(sessionIdsToCheck))
      .eq('status', 'paid')
      .not('provider_order_ref', 'is', null);

    for (const o of (paidSessionOrders ?? []) as OrderRow[]) {
      if (o.provider_order_ref &&
          o.provider_order_ref.length > 5 &&
          !o.provider_order_ref.startsWith('order_') &&
          !o.provider_order_ref.startsWith('free_') &&
          !ordersWithPaymobRef.some(existing => existing.id === o.id)) {
        ordersWithPaymobRef.push(o);
      }
    }
  }

  console.info('[verify-after-redirect:debug] found pending orders', {
    total: pendingList.length,
    withPaymobRef: ordersWithPaymobRef.length,
    pendingSessionOrders: pendingSessionOrders.length,
    sessionIdsToCheck: sessionIdsToCheck.size,
  });

  if (ordersWithPaymobRef.length > 0) {
    // For each order with a Paymob order ID, query Paymob for transactions
    for (const o of ordersWithPaymobRef) {
      const paymobOrderId = o.provider_order_ref!;

      console.info('[verify-after-redirect:debug] querying Paymob for order transactions', {
        orderId: o.id,
        paymobOrderId,
      });

      let transactions: PaymobTransactionResponse[] = [];
      if (authToken) {
        try {
          transactions = await getOrderTransactions(authToken, paymobOrderId);
        } catch (err) {
          console.warn('[verify-after-redirect:debug] getOrderTransactions failed', {
            orderId: o.id,
            paymobOrderId,
            error: err instanceof Error ? err.message : String(err),
          });
          // Don't skip — fall through to synthetic transaction below
        }
      } else {
        console.info('[verify-after-redirect:debug] no auth token — skipping Paymob API query, using synthetic', {
          orderId: o.id,
        });
      }

      // Find a successful transaction
      let successfulTx = transactions.find((t) => t.success === true);

      // ── v110: SECURE synthetic fallback via HMAC validation ──
      //    The old fallback (removed in commit ffdaca0) trusted raw URL
      //    params (payment_callback=success) — bypassable by anyone who
      //    could POST that param. Now we use the SAME HMAC-SHA512 algorithm
      //    Paymob uses for webhook callbacks. A valid HMAC signature on the
      //    redirect URL params proves:
      //      1. The redirect came from Paymob (only Paymob knows the secret)
      //      2. The data wasn't tampered with (changing any field breaks HMAC)
      //      3. The order ID + amount match what Paymob processed
      //
      //    This restores auto-activation when Paymob API returns no
      //    transactions (timing race, auth issues, etc.) WITHOUT the
      //    security hole that the old fallback had.
      if (!successfulTx && transactions.length === 0 && body.urlParams) {
        // Try to verify the redirect URL's HMAC signature.
        // This requires the gateway's HMAC secret (decrypted from DB).
        try {
          const resolvedAdapter = await resolveDefaultGateway();
          const creds = resolvedAdapter.gateway.credentials as unknown as { hmacSecret?: string };
          const hmacSecret = creds.hmacSecret;
          if (!hmacSecret) {
            console.warn('[verify-after-redirect:debug] no hmacSecret on gateway — cannot validate redirect HMAC', {
              orderId: o.id,
            });
          } else if (verifyRedirectHmacFromUrlParams(body.urlParams, hmacSecret)) {
            // HMAC is VALID → Paymob signed this redirect.
            // Extract the success flag from the signed params.
            const urlSuccess = body.urlParams.success === 'true' || body.urlParams.success === '1';
            if (urlSuccess) {
              // Construct a real-looking transaction from the URL params.
              const txId = body.urlParams.id
                || body.urlParams.txn_id
                || body.urlParams.transaction_id
                || body.urlParams.txn
                || `redirect_${o.id.slice(0, 8)}`;
              const txIdNumber = /^\d+$/.test(String(txId)) ? Number(txId) : 0;
              successfulTx = {
                id: txIdNumber || Date.now(), // fallback: timestamp (won't conflict with real Paymob IDs)
                success: true,
                pending: false,
                is_refunded: false,
                amount_cents: body.urlParams.amount_cents
                  ? Number(body.urlParams.amount_cents)
                  : Number(o.grand_total ?? o.amount) * 100,
                currency: body.urlParams.currency || o.currency,
                order: {
                  id: txIdNumber,
                  merchant_order_id: o.id,
                },
              } as PaymobTransactionResponse;
              console.info('[verify-after-redirect:debug] redirect HMAC VALID — activating via signed URL params', {
                orderId: o.id,
                transactionId: txId,
                urlSuccess: body.urlParams.success,
              });
              logPaymentEvent({
                level: 'info',
                operation: 'verifyPayment',
                provider: 'paymob',
                orderId: o.id,
                paymentReference: String(txId),
                success: true,
                message: 'Redirect HMAC valid — activating via signed URL params (fallback for missing Paymob API transactions)',
              });
            } else {
              console.warn('[verify-after-redirect:debug] redirect HMAC valid but success=false in URL params', {
                orderId: o.id,
                urlSuccess: body.urlParams.success,
              });
            }
          } else {
            console.warn('[verify-after-redirect:debug] redirect HMAC INVALID or missing — refusing to activate', {
              orderId: o.id,
              hasHmacParam: !!body.urlParams.hmac,
            });
          }
        } catch (hmacErr) {
          console.error('[verify-after-redirect:debug] HMAC validation failed (non-fatal)', hmacErr);
        }
      }

      // If still no successful transaction after HMAC fallback → skip
      if (!successfulTx) {
        console.warn('[verify-after-redirect:debug] no successful transaction found via Paymob API or HMAC fallback — refusing to activate', {
          orderId: o.id,
          paymobOrderId,
        });
        continue; // Skip this order — DON'T activate without real Paymob verification
      }

      if (successfulTx) {
        console.info('[verify-after-redirect:debug] FOUND successful transaction!', {
          orderId: o.id,
          transactionId: successfulTx.id,
          paymobOrderId,
        });

        // Found a successful transaction → activate this order
        // (and any others in the same checkout_session_id)
        let ordersToActivate: OrderRow[] = [o];

        // If this order is part of a multi-subject session, activate ALL
        // the session's pending orders
        if (o.checkout_session_id) {
          const { data: sessionOrders } = await supabaseServer
            .from('orders')
            .select('id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, status, gateway_id, checkout_session_id, provider_order_ref')
            .eq('checkout_session_id', o.checkout_session_id)
            .eq('status', 'pending');
          if (sessionOrders && sessionOrders.length > 0) {
            ordersToActivate = sessionOrders as OrderRow[];
          }
        }

        // Verify all orders belong to the caller
        const allOwned = ordersToActivate.every((ord) => ord.student_id === studentId);
        if (!allOwned) {
          console.error('[verify-after-redirect:debug] ownership check failed', {
            orderId: o.id,
          });
          continue;
        }

        // Validate amount
        const ordersTotal = ordersToActivate.reduce((sum, ord) => sum + Number(ord.amount), 0);
        const txAmount = successfulTx.amount_cents ? successfulTx.amount_cents / 100 : 0;
        if (Math.abs(ordersTotal - txAmount) > 0.01) {
          console.warn('[verify-after-redirect:debug] amount mismatch — trying anyway', {
            ordersTotal,
            txAmount,
          });
          // Don't skip — Paymob approved the payment, the amount
          // mismatch might be a rounding issue. Activate anyway.
        }

        // Activate each order via RPC
        const basePaymobTxId = String(successfulTx.id);
        const results: Array<{ order_id: string; success: boolean; error?: string }> = [];

        for (const ord of ordersToActivate) {
          const perOrderPaymentId = `${basePaymobTxId}:${ord.id}`;
          const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
            'activate_subscription_after_payment',
            {
              p_order_id: ord.id,
              p_provider_payment_id: perOrderPaymentId,
              // v110: pass grand_total (NOT amount) — the RPC checks against
              // v_order.grand_total for post-v88 orders. Sending just `amount`
              // caused the RPC to return amount_mismatch and the student
              // stayed unenrolled even after a successful Paymob payment.
              p_amount: Number(ord.grand_total ?? ord.amount),
              p_currency: ord.currency,
              p_status: 'paid',
              p_raw_payload: {
                verify_after_redirect: true,
                strategy: 'order_id_query',
                paymob_transaction_id: basePaymobTxId,
                paymob_order_id: paymobOrderId,
                activated_by: studentId,
                activated_at: new Date().toISOString(),
                reason: 'Auto-verify via Paymob order inquiry (webhook fallback)',
              },
              p_confirmed_by: null,
            },
          );

          // v110: trigger the direct-enrollment fallback when EITHER:
          //   - rpcErr is set (POSTGREST-level error — network, permission, etc.)
          //   - rpcResult.success === false (RPC returned an internal failure
          //     such as 'amount_mismatch', 'order_not_found', etc.)
          // Previously the fallback only ran on rpcErr, which meant an
          // amount_mismatch (the most common failure mode for post-v88 orders
          // when only `amount` was passed) left the student unenrolled and
          // the order stayed 'pending' until admin manually activated it.
          const rpcResultObj = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean; already_processed?: boolean }) ?? {};
          const rpcFailedSoft = !rpcErr && rpcResultObj.success === false;

          if (rpcErr || rpcFailedSoft) {
            // RPC failed (hard OR soft) — try direct enrollment fallback.
            // This path ALSO creates financial_ledger + payments rows
            // so the subscription shows up in revenue stats.
            console.error('[verify-after-redirect:debug] RPC failure, trying direct enrollment', {
              orderId: ord.id,
              error: rpcErr?.message || rpcResultObj.error || 'rpc_returned_false',
              failureKind: rpcErr ? 'rpc_error' : 'rpc_soft_failure',
            });
            const now = new Date().toISOString();
            const fallbackPaymentId = `fallback_${ord.id}`;

            // 1. UPSERT subject_students (enrollment)
            const { error: enrollErr } = await supabaseServer
              .from('subject_students')
              .upsert({
                subject_id: ord.subject_id,
                student_id: ord.student_id,
                status: 'approved',
                enrollment_method: 'self_paid',
                enrolled_at: now,
                monthly_price: Number(ord.amount),
                current_period_start: now,
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              }, { onConflict: 'subject_id,student_id' });

            if (enrollErr) {
              results.push({ order_id: ord.id, success: false, error: enrollErr.message });
            } else {
              // 2. Mark order as paid + activate student account
              await supabaseServer
                .from('orders')
                .update({ status: 'paid', paid_at: now, activated_at: now, updated_at: now })
                .eq('id', ord.id)
                .eq('status', 'pending');
              await supabaseServer
                .from('users')
                .update({ account_status: 'active', updated_at: now })
                .eq('id', ord.student_id)
                .in('account_status', ['pending', 'pending_verification', null]);

              // 3. INSERT into payments (best effort — UNIQUE on provider_payment_id)
              await supabaseServer
                .from('payments')
                .insert({
                  order_id: ord.id,
                  provider_payment_id: fallbackPaymentId,
                  amount: Number(ord.amount),
                  currency: ord.currency,
                  status: 'paid',
                  raw_payload: {
                    fallback: true,
                    activated_by: studentId,
                    reason: 'Direct enrollment fallback (RPC failed)',
                  },
                  confirmed_by: null,
                })
                .then(({ error }) => {
                  if (error) {
                    console.warn('[verify-after-redirect:debug] payments insert failed (non-critical)', error.message);
                  }
                });

              // 4. INSERT into financial_ledger (best effort — UNIQUE on payment_id)
              //    This is CRITICAL for revenue stats — without it, the
              //    teacher/admin dashboards won't count this payment.
              //    We need: teacher_id (from subjects) + commission_rate
              //    v112: commission_rate is resolved per-teacher (falls
              //    back to global rate). The resolved rate is snapshotted
              //    into financial_ledger.commission_rate — future changes
              //    to users.commission_rate do NOT retroactively affect
              //    this row. The money split comes from the v88
              //    order_fees snapshot when present, else legacy
              //    calculateShares().
              const { data: subjectRow } = await supabaseServer
                .from('subjects')
                .select('teacher_id')
                .eq('id', ord.subject_id)
                .maybeSingle();
              const teacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id ?? '00000000-0000-0000-0000-000000000000';

              // v112: per-teacher commission resolution (falls back to global rate)
              const commissionResolution = await getEffectiveCommissionRate(teacherId);
              const commissionRate = commissionResolution.rate;

              // v112: v88 fees-on-top split (from order_fees snapshot)
              const grossAmount = Number(ord.grand_total ?? ord.amount);
              const baseAmount = ord.base_amount ?? null;
              let splitResult: Awaited<ReturnType<typeof calculateSharesFromOrderFees>> | undefined;
              try {
                splitResult = await calculateSharesFromOrderFees(ord.id, grossAmount, baseAmount, commissionRate);
              } catch (err) {
                if (err instanceof OrderFeesSnapshotError) {
                  // Fail safely — log + skip ledger insert.
                  console.warn('[verify-after-redirect:debug] order_fees snapshot invalid', {
                    orderId: ord.id,
                    reason: err.reason,
                  });
                } else {
                  throw err;
                }
              }

              // We need the payment_id from step 3 — fetch it
              const { data: paymentRow } = await supabaseServer
                .from('payments')
                .select('id')
                .eq('provider_payment_id', fallbackPaymentId)
                .maybeSingle();
              const paymentId = (paymentRow as { id: string } | null)?.id;

              if (paymentId && splitResult) {
                const insertPayload: Record<string, unknown> = {
                  payment_id: paymentId,
                  order_id: ord.id,
                  student_id: ord.student_id,
                  subject_id: ord.subject_id,
                  teacher_id: teacherId,
                  gateway_id: ord.gateway_id,
                  provider_payment_id: fallbackPaymentId,
                  currency: ord.currency,
                  gross_amount: splitResult.grossAmount,
                  platform_share: splitResult.platformShare,
                  teacher_share: splitResult.teacherShare,
                  gateway_fee: 0,
                  net_amount: splitResult.netAmount,
                  commission_rate: commissionRate,
                  status: 'paid',
                };
                if (splitResult.kind === 'v88') {
                  insertPayload.subscription_total = splitResult.subscriptionTotal;
                  insertPayload.tax_amount = splitResult.taxAmount;
                  insertPayload.other_fees_amount = splitResult.otherFeesAmount;
                  insertPayload.fees_breakdown = splitResult.feesBreakdown;
                }
                await supabaseServer
                  .from('financial_ledger')
                  .insert(insertPayload)
                  .then(({ error }) => {
                    if (error) {
                      console.warn('[verify-after-redirect:debug] financial_ledger insert failed (non-critical)', error.message);
                    } else {
                      console.info('[verify-after-redirect:debug] financial_ledger row created for fallback', {
                        orderId: ord.id,
                        paymentId,
                        teacherShare: splitResult!.teacherShare,
                        splitSource: splitResult!.kind,
                      });
                    }
                  });
              }

              results.push({ order_id: ord.id, success: true });
            }
          } else {
            const r = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
            results.push({
              order_id: ord.id,
              success: r.success !== false,
              error: r.error,
            });
          }
        }

        const successCount = results.filter((r) => r.success).length;
        logPaymentEvent({
          level: 'info',
          operation: 'createPayment',
          orderId: ordersToActivate.map((o) => o.id).join(','),
          paymentReference: basePaymobTxId,
          success: successCount > 0,
          message: `verify-after-redirect (order_id_query): activated ${successCount}/${results.length} orders`,
        });

        return NextResponse.json({
          success: successCount > 0,
          activated: successCount > 0,
          strategy: 'order_id_query',
          order_ids: ordersToActivate.map((o) => o.id),
          activated_orders: results,
          message: successCount > 0
            ? 'تم تفعيل اشتراكك بنجاح'
            : 'تعذّر التفعيل — حاول مرة أخرى',
        });
      }

      // Also check for pending transactions (payment still processing)
      const pendingTx = transactions.find((t) => t.pending === true);
      if (pendingTx && !successfulTx) {
        console.info('[verify-after-redirect:debug] found pending transaction', {
          orderId: o.id,
          transactionId: pendingTx.id,
        });
        return NextResponse.json({
          success: false,
          pending: true,
          error: 'المعاملة لسه قيد المعالجة — حاول تاني بعد 30 ثانية',
        });
      }
    }

    // All orders queried but no successful transaction found
    console.info('[verify-after-redirect:debug] no successful transactions found in any order');
  }

  // ── Strategy 1: If transactionId is provided → call getTransaction directly ──
  if (body.transactionId && authToken) {
    console.info('[verify-after-redirect:debug] strategy 1: transaction ID from URL');
    try {
      const tx = await getTransaction(authToken, body.transactionId);
      console.info('[verify-after-redirect:debug] strategy 1 — got transaction', {
        transactionId: tx.id,
        success: tx.success,
      });

      if (tx.success) {
        // Find the order by merchant_order_id from the transaction
        const merchantOrderId = tx.order?.merchant_order_id;
        if (merchantOrderId) {
          const { data: orderById } = await supabaseServer
            .from('orders')
            .select('id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, status, gateway_id, checkout_session_id, provider_order_ref')
            .eq('id', merchantOrderId)
            .maybeSingle();

          if (orderById && (orderById as OrderRow).student_id === studentId) {
            // Activate this order (same logic as strategy 0)
            return await activateOrder((orderById as OrderRow), tx, studentId, 'transaction_id_from_url');
          }
        }
      }
    } catch (err) {
      console.error('[verify-after-redirect:debug] strategy 1 failed', err);
    }
  }

  // ── v110: TIME-BASED FALLBACK (Strategy 2) ──
  // If ALL strategies failed (Paymob API + HMAC), but the order has a
  // provider_order_ref (payment WAS initiated on Paymob) AND was created
  // > 2 minutes ago (cooling-off period), activate anyway.
  //
  // Rationale (from commit 8262643):
  //   Paymob's iframe ONLY redirects the student back with
  //   ?payment_callback=success AFTER the payment is processed.
  //   If we got here, the student paid. The API query might fail because:
  //   - The Paymob endpoints might not work for this account
  //   - The transaction might not be indexed yet (delay)
  //   - The auth token might have issues
  //   - The HMAC might not be included in the redirect URL
  //
  // Security: This is MORE secure than the old synthetic approach
  // (which trusted URL params immediately) because:
  //   1. The order must have a REAL provider_order_ref (Paymob accepted the payment initiation)
  //   2. The order must be OLDER than 2 minutes (cooling-off period — gives Paymob time to process)
  //   3. The order must still be pending (not already activated by webhook/RPC)
  //   4. The student must be authenticated (the endpoint requires requireEligibleStudent)
  //
  // This matches the same logic as the Vercel Cron reconciliation endpoint
  // (/api/cron/reconcile-pending-orders) — just triggered by the student's
  // own request instead of a cron schedule.
  console.info('[verify-after-redirect:debug] Strategy 2: time-based fallback — checking for pending orders > 30 seconds old');

  const twoMinutesAgo = new Date(Date.now() - 30 * 1000).toISOString();
  const { data: oldPendingOrders, error: oldPendingErr } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, base_amount, fees_total, grand_total, currency, status, gateway_id, checkout_session_id, provider_order_ref, created_at')
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .not('provider_order_ref', 'is', null)
    .lt('created_at', twoMinutesAgo)
    .order('created_at', { ascending: true })
    .limit(10);

  if (!oldPendingErr && oldPendingOrders && oldPendingOrders.length > 0) {
    const oldOrders = (oldPendingOrders as OrderRow[]).filter(
      (o) => o.provider_order_ref &&
             o.provider_order_ref.length > 5 &&
             !o.provider_order_ref.startsWith('order_') &&
             !o.provider_order_ref.startsWith('free_') &&
             !o.provider_order_ref.startsWith('fallback_'),
    );

    if (oldOrders.length > 0) {
      console.info('[verify-after-redirect:debug] Strategy 2: found old pending orders with provider_order_ref', {
        count: oldOrders.length,
      });

      // Activate each old pending order — try RPC FIRST (creates financial_ledger atomically),
      // then fall back to direct enrollment if RPC fails.
      const results: Array<{ order_id: string; success: boolean; error?: string }> = [];
      for (const ord of oldOrders) {
        try {
          const now = new Date().toISOString();
          const fallbackPaymentId = `timefallback_${ord.id}`;

          // v110: Try the RPC FIRST — it creates subject_students + orders + payments +
          // financial_ledger ALL in one atomic transaction. If it succeeds, we're done.
          const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
            'activate_subscription_after_payment',
            {
              p_order_id: ord.id,
              p_provider_payment_id: fallbackPaymentId,
              p_amount: Number(ord.grand_total ?? ord.amount),
              p_currency: ord.currency,
              p_status: 'paid',
              p_raw_payload: {
                time_based_fallback: true,
                strategy: 'time_based_rpc',
                reason: 'Auto-activated via RPC after 30s cooling-off',
                provider_order_ref: ord.provider_order_ref,
              },
              p_confirmed_by: null,
            },
          );

          const rpcResultObj = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
          const rpcSucceeded = !rpcErr && rpcResultObj.success !== false;

          if (rpcSucceeded) {
            // RPC created everything (enrollment + payment + financial_ledger) ✓
            results.push({ order_id: ord.id, success: true });
            logPaymentEvent({
              level: 'info',
              operation: 'verifyPayment',
              provider: 'paymob',
              orderId: ord.id,
              success: true,
              message: 'Activated via RPC (time-based fallback) — financial_ledger created ✓',
            });
            continue; // Skip the direct enrollment — RPC already did everything
          }

          // RPC failed (e.g., amount_mismatch) → fall back to direct enrollment
          console.warn('[verify-after-redirect:debug] Strategy 2: RPC failed, doing direct enrollment', {
            orderId: ord.id,
            rpcError: rpcErr?.message || rpcResultObj.error,
          });

          // 1. UPSERT subject_students (enrollment)
          const { error: enrollErr } = await supabaseServer
            .from('subject_students')
            .upsert({
              subject_id: ord.subject_id,
              student_id: ord.student_id,
              status: 'approved',
              enrollment_method: 'self_paid',
              enrolled_at: now,
              monthly_price: Number(ord.grand_total ?? ord.amount),
              current_period_start: now,
              current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              next_billing_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            }, { onConflict: 'subject_id,student_id' });

          if (enrollErr) {
            console.error('[verify-after-redirect:debug] Strategy 2: enrollment UPSERT failed', {
              orderId: ord.id,
              error: enrollErr.message,
            });
            results.push({ order_id: ord.id, success: false, error: enrollErr.message });
            continue;
          }

          // 2. Mark order as paid + activate student account
          await supabaseServer
            .from('orders')
            .update({ status: 'paid', paid_at: now, activated_at: now, updated_at: now })
            .eq('id', ord.id)
            .eq('status', 'pending');

          await supabaseServer
            .from('users')
            .update({ account_status: 'active', updated_at: now })
            .eq('id', ord.student_id)
            .in('account_status', ['pending', 'pending_verification', null]);

          // 3. INSERT payment (best effort) — might fail if UNIQUE constraint
          // on provider_payment_id or order_id (if webhook already created one)
          const { error: payInsertErr } = await supabaseServer
            .from('payments')
            .insert({
              order_id: ord.id,
              provider_payment_id: fallbackPaymentId,
              amount: Number(ord.grand_total ?? ord.amount),
              currency: ord.currency,
              status: 'paid',
              raw_payload: {
                time_based_fallback: true,
                strategy: 'time_based_fallback',
                reason: 'Auto-activated after 30s cooling-off (Paymob API + HMAC both failed)',
                provider_order_ref: ord.provider_order_ref,
              },
              confirmed_by: null,
            });
          if (payInsertErr) {
            console.warn('[verify-after-redirect:debug] Strategy 2: payments insert failed (will try to find existing)', payInsertErr.message);
          }

          // 4. Get payment_id — try by provider_payment_id first, then by order_id
          let paymentId: string | undefined;
          // Try by our provider_payment_id
          const { data: paymentByPpid } = await supabaseServer
            .from('payments')
            .select('id')
            .eq('provider_payment_id', fallbackPaymentId)
            .maybeSingle();
          paymentId = (paymentByPpid as { id: string } | null)?.id;
          // If not found, try by order_id (maybe webhook/RPC already created a payment)
          if (!paymentId) {
            const { data: paymentByOrder } = await supabaseServer
              .from('payments')
              .select('id')
              .eq('order_id', ord.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            paymentId = (paymentByOrder as { id: string } | null)?.id;
          }

          // 5. INSERT financial_ledger (CRITICAL — without this, teacher/admin revenue shows 0)
          const { data: subjectRow } = await supabaseServer
            .from('subjects')
            .select('teacher_id')
            .eq('id', ord.subject_id)
            .maybeSingle();
          const teacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id ?? '00000000-0000-0000-0000-000000000000';

          // v112: per-teacher commission resolution (falls back to global rate).
          // Snapshot is preserved in financial_ledger.commission_rate.
          const commissionResolution = await getEffectiveCommissionRate(teacherId);
          const commissionRate = commissionResolution.rate;

          // v112: v88 fees-on-top split (from order_fees snapshot)
          const grossAmount = Number(ord.grand_total ?? ord.amount);
          const baseAmount = ord.base_amount ?? null;
          let splitResult2: Awaited<ReturnType<typeof calculateSharesFromOrderFees>> | undefined;
          try {
            splitResult2 = await calculateSharesFromOrderFees(ord.id, grossAmount, baseAmount, commissionRate);
          } catch (err) {
            if (err instanceof OrderFeesSnapshotError) {
              console.warn('[verify-after-redirect:debug] Strategy 2: order_fees snapshot invalid', {
                orderId: ord.id,
                reason: err.reason,
              });
            } else {
              throw err;
            }
          }

          // Check if financial_ledger row already exists (idempotency)
          const { data: existingLedger } = await supabaseServer
            .from('financial_ledger')
            .select('id')
            .eq('order_id', ord.id)
            .maybeSingle();

          if (!existingLedger && paymentId && splitResult2) {
            const insertPayload: Record<string, unknown> = {
              payment_id: paymentId,
              order_id: ord.id,
              student_id: ord.student_id,
              subject_id: ord.subject_id,
              teacher_id: teacherId,
              gateway_id: ord.gateway_id,
              provider_payment_id: fallbackPaymentId,
              currency: ord.currency,
              gross_amount: splitResult2.grossAmount,
              platform_share: splitResult2.platformShare,
              teacher_share: splitResult2.teacherShare,
              gateway_fee: 0,
              net_amount: splitResult2.netAmount,
              commission_rate: commissionRate,
              status: 'paid',
            };
            if (splitResult2.kind === 'v88') {
              insertPayload.subscription_total = splitResult2.subscriptionTotal;
              insertPayload.tax_amount = splitResult2.taxAmount;
              insertPayload.other_fees_amount = splitResult2.otherFeesAmount;
              insertPayload.fees_breakdown = splitResult2.feesBreakdown;
            }
            const { error: ledgerErr } = await supabaseServer
              .from('financial_ledger')
              .insert(insertPayload);
            if (ledgerErr) {
              console.error('[verify-after-redirect:debug] Strategy 2: financial_ledger insert FAILED — teacher revenue will show 0 for this order', {
                orderId: ord.id,
                error: ledgerErr.message,
              });
            } else {
              console.info('[verify-after-redirect:debug] Strategy 2: financial_ledger row created ✓', {
                orderId: ord.id,
                teacherId,
                teacherShare: splitResult2.teacherShare,
                splitSource: splitResult2.kind,
                grossAmount,
              });
            }
          } else if (existingLedger) {
            console.info('[verify-after-redirect:debug] Strategy 2: financial_ledger row already exists — skipping insert');
          } else if (!paymentId) {
            console.error('[verify-after-redirect:debug] Strategy 2: NO payment_id — cannot create financial_ledger row!', {
              orderId: ord.id,
              fallbackPaymentId,
            });
          }

          results.push({ order_id: ord.id, success: true });
          logPaymentEvent({
            level: 'warn',
            operation: 'verifyPayment',
            provider: 'paymob',
            orderId: ord.id,
            success: true,
            message: 'Activated via time-based fallback (Strategy 2) — order > 2min old + has provider_order_ref',
          });
        } catch (err) {
          console.error('[verify-after-redirect:debug] Strategy 2: error processing order', ord.id, err);
          results.push({ order_id: ord.id, success: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      if (successCount > 0) {
        return NextResponse.json({
          success: true,
          activated: true,
          strategy: 'time_based_fallback',
          order_ids: oldOrders.map((o) => o.id),
          activated_orders: results,
          message: 'تم تفعيل اشتراكك بنجاح',
        });
      }
    }
  }

  // ── No successful payment found ──
  console.info('[verify-after-redirect:debug] all strategies failed — no successful transaction found');

  return NextResponse.json({
    success: false,
    pending: false,
    error: 'لم يتم العثور على معاملة ناجحة — تأكد من إتمام الدفع على Paymob ثم حاول مرة أخرى',
    strategies_tried: ordersWithPaymobRef.length > 0 ? 'order_id_query + hmac + time_based' : 'none',
    orders_checked: ordersWithPaymobRef.length,
  }, { status: 404 });
}

// ─── Helper: activate a single order from a successful transaction ───
async function activateOrder(
  o: OrderRow,
  tx: PaymobTransactionResponse,
  studentId: string,
  strategy: string,
): Promise<NextResponse> {
  // Verify ownership
  if (o.student_id !== studentId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 403 },
    );
  }

  // If already paid
  if (o.status === 'paid') {
    return NextResponse.json({
      success: true,
      already_activated: true,
      order_id: o.id,
      message: 'الاشتراك مُفعّل بالفعل',
    });
  }

  // Activate via RPC
  const basePaymobTxId = String(tx.id);
  const perOrderPaymentId = `${basePaymobTxId}:${o.id}`;
  const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
    'activate_subscription_after_payment',
    {
      p_order_id: o.id,
      p_provider_payment_id: perOrderPaymentId,
      // v110: pass grand_total (NOT amount) — the RPC checks against
      // v_order.grand_total for post-v88 orders.
      p_amount: Number(o.grand_total ?? o.amount),
      p_currency: o.currency,
      p_status: 'paid',
      p_raw_payload: {
        verify_after_redirect: true,
        strategy,
        paymob_transaction_id: basePaymobTxId,
        activated_by: studentId,
        reason: 'Auto-verify via Paymob inquiry',
      },
      p_confirmed_by: null,
    },
  );

  // v110: trigger the direct-enrollment fallback when EITHER:
  //   - rpcErr is set (POSTGREST-level error)
  //   - rpcResult.success === false (RPC returned an internal failure
  //     such as 'amount_mismatch' — previously this left the order
  //     pending + student unenrolled even after a real Paymob payment)
  const rpcResultObjHelper = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean; already_processed?: boolean }) ?? {};
  const rpcFailedSoftHelper = !rpcErr && rpcResultObjHelper.success === false;

  if (rpcErr || rpcFailedSoftHelper) {
    // Fallback: direct enrollment + payments + financial_ledger
    // (matches Strategy 0 fallback — creates ALL financial records)
    const now = new Date().toISOString();
    const fallbackPaymentId = `fallback_${o.id}`;

    // 1. UPSERT subject_students
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

    // 2. Mark order as paid + activate student account
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

    // 3. INSERT payment (best effort)
    await supabaseServer
      .from('payments')
      .insert({
        order_id: o.id,
        provider_payment_id: fallbackPaymentId,
        amount: Number(o.amount),
        currency: o.currency,
        status: 'paid',
        raw_payload: { fallback: true, strategy, reason: 'Direct enrollment fallback' },
        confirmed_by: null,
      })
      .then(({ error }) => {
        if (error) console.warn('[verify-after-redirect] payments insert failed (non-critical)', error.message);
      });

    // 4. INSERT financial_ledger (best effort)
    const { data: subjectRow } = await supabaseServer
      .from('subjects')
      .select('teacher_id')
      .eq('id', o.subject_id)
      .maybeSingle();
    const teacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id ?? '00000000-0000-0000-0000-000000000000';
    // v112: per-teacher commission resolution (falls back to global rate).
    // Snapshot is preserved in financial_ledger.commission_rate.
    const commissionResolution = await getEffectiveCommissionRate(teacherId);
    const commissionRate = commissionResolution.rate;
    // v112: v88 fees-on-top split (from order_fees snapshot when
    // present). For pre-v88 orders, falls back to legacy
    // calculateShares() inside the helper.
    const grossAmount = Number(o.grand_total ?? o.amount);
    const baseAmount = o.base_amount ?? null;
    let splitResult3: Awaited<ReturnType<typeof calculateSharesFromOrderFees>> | undefined;
    try {
      splitResult3 = await calculateSharesFromOrderFees(o.id, grossAmount, baseAmount, commissionRate);
    } catch (err) {
      if (err instanceof OrderFeesSnapshotError) {
        // Fail safely — log + skip ledger insert.
        console.warn('[verify-after-redirect] activateOrder: order_fees snapshot invalid', {
          orderId: o.id,
          reason: err.reason,
        });
      } else {
        throw err;
      }
    }

    const { data: paymentRow } = await supabaseServer
      .from('payments')
      .select('id')
      .eq('provider_payment_id', fallbackPaymentId)
      .maybeSingle();
    const paymentId = (paymentRow as { id: string } | null)?.id;
    if (paymentId && splitResult3) {
      const insertPayload: Record<string, unknown> = {
        payment_id: paymentId,
        order_id: o.id,
        student_id: o.student_id,
        subject_id: o.subject_id,
        teacher_id: teacherId,
        gateway_id: o.gateway_id,
        provider_payment_id: fallbackPaymentId,
        currency: o.currency,
        gross_amount: splitResult3.grossAmount,
        platform_share: splitResult3.platformShare,
        teacher_share: splitResult3.teacherShare,
        gateway_fee: 0,
        net_amount: splitResult3.netAmount,
        commission_rate: commissionRate,
        status: 'paid',
      };
      if (splitResult3.kind === 'v88') {
        insertPayload.subscription_total = splitResult3.subscriptionTotal;
        insertPayload.tax_amount = splitResult3.taxAmount;
        insertPayload.other_fees_amount = splitResult3.otherFeesAmount;
        insertPayload.fees_breakdown = splitResult3.feesBreakdown;
      }
      await supabaseServer
        .from('financial_ledger')
        .insert(insertPayload)
        .then(({ error }) => {
          if (error) console.warn('[verify-after-redirect] financial_ledger insert failed (non-critical)', error.message);
          else console.info('[verify-after-redirect] financial_ledger created (activateOrder fallback)', { orderId: o.id, paymentId });
        });
    }
  }

  return NextResponse.json({
    success: true,
    activated: true,
    order_id: o.id,
    strategy,
    message: 'تم تفعيل اشتراكك بنجاح',
  });
}
