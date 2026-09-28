import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import { resolveDefaultGateway } from '@/lib/payment/resolver';
import { getAuthToken, getTransaction } from '@/lib/payment/providers/paymob/client';
import type { PaymobTransactionResponse } from '@/lib/payment/providers/paymob/client';

/**
 * POST /api/student/orders/verify-after-redirect
 *
 * Body: {
 *   transactionId?: string,    // Paymob transaction ID (numeric, from URL ?id=xxx)
 *   orderId?: string,         // Paymob order ID (numeric, from URL ?order_id=xxx)
 *   merchantOrderId?: string, // our internal order UUID or session_id (from URL ?merchant_order_id=xxx)
 *   urlParams?: Record<string, string>, // ALL URL params from the redirect (for logging)
 * }
 *
 * Called by the student's browser AFTER being redirected back from
 * Paymob. The redirect URL includes various Paymob params (?id,
 * ?order_id, ?merchant_order_id, ?success, ?hmac, etc.).
 *
 * This endpoint tries MULTIPLE strategies to verify the payment:
 *
 *   Strategy 1: If transactionId is provided → call Paymob's transaction
 *               API directly to get the latest status.
 *
 *   Strategy 2: If merchantOrderId is provided → look up the order(s)
 *               in our DB, then use the Paymob order ID (from
 *               provider_order_ref) to find the transaction.
 *
 *   Strategy 3: If neither is available → fall back to checking ALL
 *               the student's pending orders using their stored
 *               provider_order_ref.
 *
 * For each successfully-verified transaction, the endpoint calls the
 * activate_subscription_after_payment RPC (idempotent — safe to call
 * multiple times).
 *
 * SECURITY:
 *   - Caller must be a logged-in student
 *   - Paymob's transaction API is the SOURCE OF TRUTH (we don't trust
 *     the redirect URL params for payment success — we ask Paymob)
 *   - Order ownership verified (orders.student_id = caller.id)
 *   - Amount verified (tx.amount === SUM(orders.amount))
 *   - The activate_subscription_after_payment RPC has idempotency
 *     built-in (safe to call multiple times — won't double-charge)
 *
 * WHY THIS EXISTS:
 *   The webhook is the primary source of truth, but it can fail to
 *   fire due to:
 *     - Paymob's webhook service having issues
 *     - Network connectivity issues
 *     - Account-level webhook URL not configured (Accept API flow)
 *   This endpoint is a FALLBACK that activates the subscription
 *   directly when the student returns to the app after payment.
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
    urlParams: body.urlParams,
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

  // 2. Get auth token
  let authToken: string;
  try {
    authToken = await getAuthToken(secretKey);
  } catch (err) {
    console.error('[verify-after-redirect:debug] failed to get auth token', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'تعذّر الاتصال ببوابة الدفع' },
      { status: 502 },
    );
  }

  // 3. Try multiple strategies to verify the transaction
  let tx: PaymobTransactionResponse | null = null;
  let ordersToActivate: OrderRow[] = [];
  let strategyUsed = '';

  // ── Strategy 1: transactionId from URL → call transaction API directly ──
  if (body.transactionId) {
    strategyUsed = 'transaction_id_from_url';
    try {
      tx = await getTransaction(authToken, body.transactionId);
      console.info('[verify-after-redirect:debug] strategy 1 — transaction API OK', {
        transactionId: tx.id,
        success: tx.success,
        merchant_order_id: tx.order?.merchant_order_id,
      });
    } catch (err) {
      console.error('[verify-after-redirect:debug] strategy 1 — transaction API failed', {
        transactionId: body.transactionId,
        error: err instanceof Error ? err.message : String(err),
      });
      tx = null;
    }
  }

  // ── Strategy 2: Look up by merchantOrderId (our UUID) ──
  if (!tx && body.merchantOrderId) {
    strategyUsed = 'merchant_order_id_lookup';
    console.info('[verify-after-redirect:debug] strategy 2 — looking up order by merchantOrderId', {
      merchantOrderId: body.merchantOrderId,
    });

    // Try as our order UUID first
    const { data: orderById } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
      .eq('id', body.merchantOrderId)
      .maybeSingle();

    if (orderById) {
      ordersToActivate = [orderById as OrderRow];
    } else {
      // Try as checkout_session_id (multi-subject)
      const { data: sessionOrders } = await supabaseServer
        .from('orders')
        .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
        .eq('checkout_session_id', body.merchantOrderId);
      if (sessionOrders && sessionOrders.length > 0) {
        ordersToActivate = sessionOrders as OrderRow[];
      }
    }

    // For each order found, try to get the Paymob transaction
    // using the order's provider_order_ref (which is the Paymob order ID
    // stored when the payment was initiated)
    if (ordersToActivate.length > 0) {
      // Use the first order's provider_order_ref as a starting point
      const firstOrder = ordersToActivate[0];
      if (firstOrder.provider_order_ref && /^\d+$/.test(firstOrder.provider_order_ref)) {
        // The provider_order_ref is a numeric Paymob order ID
        // Try to query transactions by Paymob order ID
        // (Paymob's API supports `/api/acceptance/transactions/?order_id=xxx`)
        try {
          const paymobRes = await fetch(
            `https://accept.paymob.com/api/acceptance/transactions/?order_id=${firstOrder.provider_order_ref}`,
            {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${authToken}` },
              signal: AbortSignal.timeout(10000),
            }
          );
          if (paymobRes.ok) {
            const paymobJson = await paymobRes.json();
            // Paymob returns array of transactions
            const transactions = Array.isArray(paymobJson) ? paymobJson :
              (paymobJson.results && Array.isArray(paymobJson.results) ? paymobJson.results : []);
            // Find the first successful transaction
            const successfulTx = transactions.find((t: Record<string, unknown>) => t.success === true);
            if (successfulTx) {
              tx = successfulTx as unknown as PaymobTransactionResponse;
              console.info('[verify-after-redirect:debug] strategy 2 — found transaction via order lookup', {
                transactionId: tx.id,
              });
            }
          }
        } catch (err) {
          console.error('[verify-after-redirect:debug] strategy 2 — order-based lookup failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // ── Strategy 3: Fall back to checking ALL student's pending orders ──
  if (!tx) {
    strategyUsed = 'all_pending_orders';
    console.info('[verify-after-redirect:debug] strategy 3 — checking all pending orders');

    const { data: pendingOrders } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
      .eq('student_id', studentId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5);

    if (pendingOrders && pendingOrders.length > 0) {
      const pendingList = pendingOrders as OrderRow[];

      // For each pending order, try to find a transaction
      for (const o of pendingList) {
        if (!o.provider_order_ref || !/^\d+$/.test(o.provider_order_ref)) continue;
        try {
          const paymobRes = await fetch(
            `https://accept.paymob.com/api/acceptance/transactions/?order_id=${o.provider_order_ref}`,
            {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${authToken}` },
              signal: AbortSignal.timeout(10000),
            }
          );
          if (paymobRes.ok) {
            const paymobJson = await paymobRes.json();
            const transactions = Array.isArray(paymobJson) ? paymobJson :
              (paymobJson.results && Array.isArray(paymobJson.results) ? paymobJson.results : []);
            const successfulTx = transactions.find((t: Record<string, unknown>) => t.success === true);
            if (successfulTx) {
              tx = successfulTx as unknown as PaymobTransactionResponse;
              ordersToActivate = [o];
              console.info('[verify-after-redirect:debug] strategy 3 — found paid order', {
                orderId: o.id,
                transactionId: tx.id,
              });
              break;
            }
          }
        } catch {
          // continue to next order
        }
      }
    }
  }

  // If we have a transaction (from any strategy), look up orders
  if (tx && ordersToActivate.length === 0) {
    // Use the transaction's merchant_order_id to find our orders
    const merchantOrderId = tx.order?.merchant_order_id;
    if (merchantOrderId) {
      // Try as our order UUID
      const { data: orderById } = await supabaseServer
        .from('orders')
        .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
        .eq('id', merchantOrderId)
        .maybeSingle();
      if (orderById) {
        ordersToActivate = [orderById as OrderRow];
      } else {
        // Try as checkout_session_id (multi-subject)
        const { data: sessionOrders } = await supabaseServer
          .from('orders')
          .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id, provider_order_ref')
          .eq('checkout_session_id', merchantOrderId);
        if (sessionOrders && sessionOrders.length > 0) {
          ordersToActivate = sessionOrders as OrderRow[];
        }
      }
    }
  }

  // If still no orders + no transaction, return a helpful error
  if (ordersToActivate.length === 0 && !tx) {
    console.error('[verify-after-redirect:debug] all strategies failed — no transaction + no orders', {
      strategyUsed,
      urlParams: body.urlParams,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر التحقق من الدفعة — حاول مرة أخرى بعد قليل أو تواصل مع الدعم',
        strategy: strategyUsed,
      },
      { status: 404 },
    );
  }

  // If we have a transaction, verify it's successful
  if (tx && !tx.success) {
    console.warn('[verify-after-redirect:debug] transaction found but not successful', {
      transactionId: tx.id,
      success: tx.success,
      pending: tx.pending,
    });
    return NextResponse.json(
      {
        success: false,
        error: tx.pending ? 'المعاملة لسه قيد المعالجة — حاول مرة أخرى بعد 30 ثانية' : 'المعاملة لم تكتمل بنجاح',
        pending: tx.pending,
      },
      { status: 400 },
    );
  }

  // If we have no transaction (only orders), we can't verify with Paymob
  // — return an error (we can't just activate without verification)
  if (!tx) {
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر العثور على معاملة ناجحة في Paymob — تأكد إن الدفعة اتعملت approved',
        strategy: strategyUsed,
      },
      { status: 404 },
    );
  }

  // 4. Verify ALL orders belong to the caller
  const allOwned = ordersToActivate.every((o) => o.student_id === studentId);
  if (!allOwned) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — بعض الطلبات لا تنتمي إليك' },
      { status: 403 },
    );
  }

  // 5. Validate amount
  const ordersTotal = ordersToActivate.reduce((sum, o) => sum + Number(o.amount), 0);
  const txAmount = tx.amount_cents ? tx.amount_cents / 100 : 0;
  if (Math.abs(ordersTotal - txAmount) > 0.01) {
    console.error('[verify-after-redirect:debug] amount mismatch', {
      ordersTotal,
      txAmount,
    });
    return NextResponse.json(
      { success: false, error: 'مبلغ المعاملة لا يطابق إجمالي الطلبات' },
      { status: 400 },
    );
  }

  // 6. Activate each pending order via the RPC
  const basePaymobTxId = String(tx.id);
  const results: Array<{ order_id: string; success: boolean; already_paid?: boolean; error?: string }> = [];

  for (const o of ordersToActivate) {
    if (o.status === 'paid') {
      results.push({ order_id: o.id, success: true, already_paid: true });
      continue;
    }
    if (o.status !== 'pending') {
      results.push({ order_id: o.id, success: false, error: `status=${o.status}` });
      continue;
    }

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
          strategy: strategyUsed,
          paymob_transaction_id: basePaymobTxId,
          activated_by: studentId,
          activated_at: new Date().toISOString(),
          reason: 'Manual verify after redirect (webhook did not fire or was delayed)',
        },
        p_confirmed_by: null,
      },
    );

    if (rpcErr) {
      console.error('[verify-after-redirect:debug] RPC error', {
        orderId: o.id,
        error: rpcErr.message,
      });
      results.push({ order_id: o.id, success: false, error: rpcErr.message });
    } else {
      const r = (rpcResult as { success?: boolean; error?: string; already_paid?: boolean }) ?? {};
      results.push({
        order_id: o.id,
        success: r.success !== false,
        already_paid: r.already_paid === true,
        error: r.error,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const totalCount = results.length;
  const allSuccess = successCount === totalCount;

  logPaymentEvent({
    level: allSuccess ? 'info' : 'warn',
    operation: 'createPayment',
    orderId: ordersToActivate.map((o) => o.id).join(','),
    paymentReference: basePaymobTxId,
    success: allSuccess,
    message: `verify-after-redirect (${strategyUsed}): activated ${successCount}/${totalCount} orders`,
  });

  return NextResponse.json({
    success: allSuccess,
    activated: allSuccess,
    strategy: strategyUsed,
    order_ids: ordersToActivate.map((o) => o.id),
    activated_orders: results,
    message: allSuccess
      ? 'تم تفعيل اشتراكاتك بنجاح'
      : `تم تفعيل ${successCount} من ${totalCount} طلبات`,
  });
}
