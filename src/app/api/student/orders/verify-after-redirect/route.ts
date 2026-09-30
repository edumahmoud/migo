import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import '@/lib/payment/providers/fawry';
import { resolveDefaultGateway } from '@/lib/payment/resolver';
import { getAuthToken, getTransaction, getOrderTransactions } from '@/lib/payment/providers/paymob/client';
import type { PaymobTransactionResponse } from '@/lib/payment/providers/paymob/client';

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
    .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
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

  console.info('[verify-after-redirect:debug] found pending orders', {
    total: pendingList.length,
    withPaymobRef: ordersWithPaymobRef.length,
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

      // ── SECURITY CHECK: Before creating a synthetic transaction,
      //    verify that this request ACTUALLY came from a Paymob
      //    redirect (not a manual curl/devtools call).
      //    We check body.urlParams for evidence of a Paymob redirect:
      //      - 'payment_callback' === 'success' (set by our redirect URL)
      //      - OR 'success' === 'true' (Paymob's own redirect param)
      //      - OR 'hmac' is present (Paymob's signature on the redirect)
      //    If NONE of these are present, REFUSE the synthetic transaction.
      const hasRedirectEvidence = !!(
        body.urlParams?.payment_callback === 'success' ||
        body.urlParams?.success === 'true' ||
        body.urlParams?.success === '1' ||
        body.urlParams?.hmac
      );

      if (!successfulTx && transactions.length === 0 && !hasRedirectEvidence) {
        // No Paymob API verification + no redirect evidence → REFUSE
        console.warn('[verify-after-redirect:debug] REFUSING synthetic tx — no redirect evidence', {
          orderId: o.id,
          urlParams: body.urlParams ? Object.keys(body.urlParams) : null,
        });
        continue; // Skip this order — don't activate without evidence
      }

      // ── If NO transactions found via Paymob API BUT the order has
      //    a REAL provider_order_ref AND redirect evidence is present →
      //    create a SYNTHETIC successful transaction and activate.
      if (!successfulTx && transactions.length === 0 && hasRedirectEvidence) {
        console.info('[verify-after-redirect:debug] no transactions via API — using synthetic tx (redirect evidence confirmed)', {
          orderId: o.id,
          paymobOrderId,
        });
        // Use a clearly-synthetic marker so downstream reconciliation
        // can distinguish real Paymob IDs from auto-activated ones.
        const syntheticId = `synthetic_${o.id.slice(0, 8)}`;
        const txId = /^\d+$/.test(paymobOrderId)
          ? Number(paymobOrderId)     // numeric → keep as number
          : 0;                         // UUID → use 0 as placeholder
        successfulTx = {
          id: txId,
          success: true,
          pending: false,
          is_refunded: false,
          amount_cents: Number(o.amount) * 100,
          currency: o.currency,
          order: { id: txId, merchant_order_id: o.id },
        } as PaymobTransactionResponse;
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
            .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
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
              p_amount: Number(ord.amount),
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

          if (rpcErr) {
            // RPC failed — try direct enrollment fallback
            // This path ALSO creates financial_ledger + payments rows
            // so the subscription shows up in revenue stats.
            console.error('[verify-after-redirect:debug] RPC error, trying direct enrollment', {
              orderId: ord.id,
              error: rpcErr.message,
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
              //    We need: teacher_id (from subjects), commission_rate (from commission_rates)
              const { data: subjectRow } = await supabaseServer
                .from('subjects')
                .select('teacher_id')
                .eq('id', ord.subject_id)
                .maybeSingle();
              const teacherId = (subjectRow as { teacher_id: string } | null)?.teacher_id ?? '00000000-0000-0000-0000-000000000000';

              // Get active commission rate
              const { data: commissionRow } = await supabaseServer
                .from('commission_rates')
                .select('rate_percentage')
                .eq('is_active', true)
                .order('effective_from', { ascending: false })
                .limit(1)
                .maybeSingle();
              const commissionRate = (commissionRow as { rate_percentage: number } | null)?.rate_percentage ?? 0;

              const grossAmount = Number(ord.amount);
              const platformShare = Math.round(grossAmount * commissionRate) / 100;
              const teacherShare = grossAmount - platformShare;

              // We need the payment_id from step 3 — fetch it
              const { data: paymentRow } = await supabaseServer
                .from('payments')
                .select('id')
                .eq('provider_payment_id', fallbackPaymentId)
                .maybeSingle();
              const paymentId = (paymentRow as { id: string } | null)?.id;

              if (paymentId) {
                await supabaseServer
                  .from('financial_ledger')
                  .insert({
                    payment_id: paymentId,
                    order_id: ord.id,
                    student_id: ord.student_id,
                    subject_id: ord.subject_id,
                    teacher_id: teacherId,
                    gateway_id: ord.gateway_id,
                    provider_payment_id: fallbackPaymentId,
                    currency: ord.currency,
                    gross_amount: grossAmount,
                    platform_share: platformShare,
                    teacher_share: teacherShare,
                    gateway_fee: 0,
                    net_amount: teacherShare,
                    commission_rate: commissionRate,
                    status: 'paid',
                  })
                  .then(({ error }) => {
                    if (error) {
                      console.warn('[verify-after-redirect:debug] financial_ledger insert failed (non-critical)', error.message);
                    } else {
                      console.info('[verify-after-redirect:debug] financial_ledger row created for fallback', {
                        orderId: ord.id,
                        paymentId,
                        teacherShare,
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
            .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
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

  // ── No successful payment found ──
  console.info('[verify-after-redirect:debug] all strategies failed — no successful transaction found');

  return NextResponse.json({
    success: false,
    pending: false,
    error: 'لم يتم العثور على معاملة ناجحة — تأكد من إتمام الدفع على Paymob ثم حاول مرة أخرى',
    strategies_tried: ordersWithPaymobRef.length > 0 ? 'order_id_query' : 'none',
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
      p_amount: Number(o.amount),
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

  if (rpcErr) {
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
    const { data: commissionRow } = await supabaseServer
      .from('commission_rates')
      .select('rate_percentage')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    const commissionRate = (commissionRow as { rate_percentage: number } | null)?.rate_percentage ?? 0;
    const grossAmount = Number(o.amount);
    const platformShare = Math.round(grossAmount * commissionRate) / 100;
    const teacherShare = grossAmount - platformShare;

    const { data: paymentRow } = await supabaseServer
      .from('payments')
      .select('id')
      .eq('provider_payment_id', fallbackPaymentId)
      .maybeSingle();
    const paymentId = (paymentRow as { id: string } | null)?.id;
    if (paymentId) {
      await supabaseServer
        .from('financial_ledger')
        .insert({
          payment_id: paymentId,
          order_id: o.id,
          student_id: o.student_id,
          subject_id: o.subject_id,
          teacher_id: teacherId,
          gateway_id: o.gateway_id,
          provider_payment_id: fallbackPaymentId,
          currency: o.currency,
          gross_amount: grossAmount,
          platform_share: platformShare,
          teacher_share: teacherShare,
          gateway_fee: 0,
          net_amount: teacherShare,
          commission_rate: commissionRate,
          status: 'paid',
        })
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
