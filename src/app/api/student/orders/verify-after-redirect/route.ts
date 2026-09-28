import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';
import { logPaymentEvent } from '@/lib/payment/logger';

// Import the payment core (registers the Paymob adapter)
import '@/lib/payment/providers/paymob';
import { resolveDefaultGateway } from '@/lib/payment/resolver';
import { getAuthToken, getTransaction } from '@/lib/payment/providers/paymob/client';

/**
 * POST /api/student/orders/verify-after-redirect
 *
 * Body: { paymobTransactionId: string }
 *
 * Called by the student's browser AFTER being redirected back from
 * Paymob. The redirect URL includes the Paymob transaction ID as a
 * query param (?id=xxx).
 *
 * This endpoint:
 *   1. Calls Paymob's transaction API to get the latest status
 *   2. Verifies the transaction is successful
 *   3. Finds the matching order(s) in our DB (by merchant_order_id
 *      returned in the transaction — can be a single order UUID OR
 *      a checkout_session_id for multi-subject sessions)
 *   4. Verifies the caller owns the order(s)
 *   5. Calls the activate_subscription_after_payment RPC for each
 *
 * SECURITY:
 *   - Caller must be a logged-in student
 *   - The transaction's order.merchant_order_id must match an order
 *     owned by the caller
 *   - Paymob's transaction API is the SOURCE OF TRUTH (we don't trust
 *     the redirect URL params — we ask Paymob directly)
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

const BodySchema = z.object({
  paymobTransactionId: z.string().min(1).max(100),
});

interface OrderRow {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  gateway_id: string | null;
  checkout_session_id: string | null;
}

export async function POST(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'paymobTransactionId مطلوب' },
      { status: 400 },
    );
  }

  const { paymobTransactionId } = parsed.data;
  const studentId = auth.user.id;

  console.info('[verify-after-redirect:debug] received request', {
    paymobTransactionId,
    studentId,
  });

  // 1. Resolve the default gateway to get the secretKey
  let resolvedAdapter;
  try {
    resolvedAdapter = await resolveDefaultGateway();
  } catch (err) {
    console.error('[verify-after-redirect:debug] failed to resolve default gateway', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'بوابة الدفع غير مُهيّأة' },
      { status: 503 },
    );
  }

  const gateway = resolvedAdapter.gateway;
  const creds = gateway.credentials as unknown as { secretKey: string };

  // 2. Get auth token + call Paymob's transaction API
  let authToken: string;
  try {
    authToken = await getAuthToken(creds.secretKey);
  } catch (err) {
    console.error('[verify-after-redirect:debug] failed to get auth token', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'تعذّر الاتصال ببوابة الدفع' },
      { status: 502 },
    );
  }

  let tx;
  try {
    tx = await getTransaction(authToken, paymobTransactionId);
  } catch (err) {
    console.error('[verify-after-redirect:debug] failed to get transaction', {
      paymobTransactionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'تعذّر التحقق من المعاملة من بوابة الدفع' },
      { status: 502 },
    );
  }

  console.info('[verify-after-redirect:debug] got transaction', {
    transactionId: tx.id,
    success: tx.success,
    pending: tx.pending,
    is_refunded: tx.is_refunded,
    amount_cents: tx.amount_cents,
    currency: tx.currency,
    merchant_order_id: tx.order?.merchant_order_id,
  });

  // 3. Extract our internal order UUID (or session_id) from the transaction
  const merchantOrderId = tx.order?.merchant_order_id;
  if (!merchantOrderId) {
    console.error('[verify-after-redirect:debug] transaction has no merchant_order_id', {
      transactionId: tx.id,
    });
    return NextResponse.json(
      { success: false, error: 'المعاملة لا تحتوي على معرّف الطلب' },
      { status: 400 },
    );
  }

  // 4. Verify the transaction was successful
  if (!tx.success) {
    return NextResponse.json(
      { success: false, error: 'المعاملة لم تكتمل بنجاح' },
      { status: 400 },
    );
  }

  // 5. Look up our order(s) by merchant_order_id.
  //    It can be:
  //      - A single order UUID (single-order Accept API flow)
  //      - A checkout_session_id (multi-subject Intention API flow →
  //        set as special_reference)
  //
  //    Try BOTH: look up by id first, then by checkout_session_id.
  const { data: orderById } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id')
    .eq('id', merchantOrderId)
    .maybeSingle();

  let ordersToActivate: OrderRow[] = [];

  if (orderById) {
    ordersToActivate = [orderById as OrderRow];
  } else {
    // Try as checkout_session_id (multi-subject)
    const { data: sessionOrders, error: sessionErr } = await supabaseServer
      .from('orders')
      .select('id, student_id, subject_id, amount, currency, status, gateway_id, checkout_session_id')
      .eq('checkout_session_id', merchantOrderId);

    if (!sessionErr && sessionOrders && sessionOrders.length > 0) {
      ordersToActivate = sessionOrders as OrderRow[];
    }
  }

  if (ordersToActivate.length === 0) {
    console.error('[verify-after-redirect:debug] no orders found', {
      merchantOrderId,
    });
    return NextResponse.json(
      { success: false, error: 'لا توجد طلبات مطابقة لهذه المعاملة' },
      { status: 404 },
    );
  }

  // 6. Verify ALL orders belong to the caller
  const allOwned = ordersToActivate.every((o) => o.student_id === studentId);
  if (!allOwned) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — بعض الطلبات لا تنتمي إليك' },
      { status: 403 },
    );
  }

  // 7. Validate the transaction amount matches SUM(orders.amount)
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

  // 8. Activate each pending order via the RPC
  //    (idempotent — safe to call multiple times)
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
    orderId: merchantOrderId,
    paymentReference: basePaymobTxId,
    success: allSuccess,
    message: `verify-after-redirect: activated ${successCount}/${totalCount} orders`,
  });

  return NextResponse.json({
    success: allSuccess,
    activated: allSuccess,
    order_ids: ordersToActivate.map((o) => o.id),
    activated_orders: results,
    message: allSuccess
      ? 'تم تفعيل اشتراكاتك بنجاح'
      : `تم تفعيل ${successCount} من ${totalCount} طلبات`,
  });
}
