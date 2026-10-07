'use client';

/**
 * Payment Summary Dialog — Student Checkout UI (Single + Multi-Subject)
 *
 * Reusable dialog shown BEFORE a student confirms payment for one or
 * more pending paid orders. The dialog supports TWO modes:
 *
 *   1. SINGLE-ORDER mode (Phase 14.0):
 *      - Pass `order: PaymentSummaryOrder` (one order).
 *      - Pay Now calls initiatePayment(order.orderId) → POST /api/student/orders/[id]/pay
 *      - Used by: student-activation-page pending-order "Complete Payment" button.
 *
 *   2. MULTI-SESSION mode (Phase 14.1):
 *      - Pass `sessionItems: CheckoutSessionItem[]` (multiple orders) +
 *        a pre-created `sessionId` (from createCheckoutSession()).
 *      - Pay Now calls initiateSessionPayment(sessionId) → POST /api/student/checkout/sessions/[id]/pay
 *      - Used by: subjects-section multi-subject subscribe flow.
 *
 * SECURITY:
 *   - The dialog never trusts a client-supplied price/currency/student_id.
 *     It displays values that came from the server response (the
 *     POST /api/student/orders response, or the createCheckoutSession response).
 *   - The dialog never directly marks an order as paid. Only the Paymob
 *     webhook (server-to-server) can transition orders to 'paid'.
 *   - No Paymob secrets/credentials/tokens are exposed to the client.
 *
 * STATE UX:
 *   - "جاهز للدفع" (ready) — initial state, Pay Now enabled.
 *   - "جارٍ تجهيز الدفع..." (preparing payment) — Pay Now clicked, request in-flight.
 *   - "جارٍ التحويل إلى بوابة الدفع..." (redirecting) — checkout URL received,
 *     about to navigate away.
 *   - Error display — categorized Arabic message from getPaymentActionErrorMessage.
 *
 * DUPLICATE PREVENTION:
 *   - Pay Now is disabled while a payment is being initiated (no double-click).
 *   - The dialog cannot be closed while in the redirecting state (the browser
 *     is about to navigate away).
 *   - The backend endpoint is itself idempotent — re-calling /pay returns the
 *     same checkout URL (Paymob deduplicates via special_reference).
 *
 * Accessibility:
 *   - Built on the existing src/components/ui/dialog (Radix-based).
 *   - Keyboard accessible (Tab cycle, Esc to close — Radix default).
 *   - dir="rtl" | "ltr" follows the project's i18n direction.
 *
 * Mobile + Desktop:
 *   - sm:max-w-md (mobile-first) → max-w-lg (desktop) for multi-item.
 *   - max-h-[90vh] overflow-y-auto for long item lists.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Loader2, CreditCard, X, AlertCircle, ShieldCheck, ExternalLink, Smartphone, Banknote } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';
import {
  initiatePayment,
  initiateSessionPayment,
  redirectToCheckout,
  removeCheckoutSessionItem,
  getPaymentActionErrorMessage,
  PaymentActionError,
  type PaymentSummaryOrder,
  type CheckoutSessionItem,
} from '@/lib/student/payment-action';

// Re-export PaymentSummaryOrder + CheckoutSessionItem so existing
// import sites (subjects-section.tsx, student-activation-page.tsx)
// can keep importing them from the dialog component.
export type { PaymentSummaryOrder, CheckoutSessionItem };

// ─── Props ───
interface PaymentSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // SINGLE-ORDER mode: pass `order` (single)
  order?: PaymentSummaryOrder | null;

  // MULTI-SESSION mode: pass `sessionItems` (array) + `sessionId`
  sessionItems?: CheckoutSessionItem[] | null;
  sessionId?: string | null;

  // MULTI-SESSION item removal callback (optional).
  // When the user clicks the remove (X) button on an item, the dialog
  // calls removeCheckoutSessionItem(sessionId, orderId) server-side,
  // then calls this callback with the updated items array so the
  // parent can update its state. If the callback is not provided,
  // the remove button is hidden (backward compat with single-order mode).
  onSessionItemsChange?: (items: CheckoutSessionItem[]) => void;
}

type PaymentState = 'ready' | 'preparing' | 'redirecting' | 'error' | 'fawry_pending';

export function PaymentSummaryDialog({
  open,
  onOpenChange,
  order,
  sessionItems,
  sessionId,
  onSessionItemsChange,
}: PaymentSummaryDialogProps) {
  const { t, direction } = useTranslations();
  const [state, setState] = useState<PaymentState>('ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removingOrderId, setRemovingOrderId] = useState<string | null>(null);
  // Payment method picker: card | wallet | fawry
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'wallet' | 'fawry'>('card');
  // v88+ — Fawry Code display: the reference code returned by the adapter
  const [fawryReferenceCode, setFawryReferenceCode] = useState<string | null>(null);
  const [fawryPollCount, setFawryPollCount] = useState(0);

  // Determine mode + items to display
  const isMultiMode = !order && Array.isArray(sessionItems) && sessionItems.length > 0 && !!sessionId;
  // v116: extend items shape to include optional subject_price (original
  // catalog price) + base_amount (charged price after plan selection).
  // For multi-mode these come from the new checkout-sessions API response.
  // For single-order mode, the dialog fetches /api/student/orders/[id]
  // separately to populate feesData — subject_price is the order.amount
  // fallback (since base_amount IS the plan price when a plan was used).
  //
  // v116 fix: the per-item `amount` shown to the user is the BASE price
  // (= base_amount OR subject_price OR grand_total as last-resort fallback),
  // NOT the grand_total. The grand_total appears in the breakdown section
  // below (base + fees = grand_total). Showing grand_total per-item would
  // double-count the fees (the user would see X+fees per item, then base
  // + fees = grand total AGAIN at the bottom).
  const items: Array<{ subjectName: string; amount: number; currency: string; subjectPrice?: number }> = isMultiMode
    ? (sessionItems as CheckoutSessionItem[]).map((it) => {
        const baseAmount = it.base_amount !== undefined ? Number(it.base_amount)
          : (it.subject_price !== undefined ? Number(it.subject_price) : Number(it.amount));
        return {
          subjectName: it.subject_name,
          amount: baseAmount,
          currency: it.currency,
          subjectPrice: it.subject_price !== undefined ? Number(it.subject_price) : undefined,
        };
      })
    // v88+ — show the BASE price (subscription cost) as the item amount,
    // NOT the grand_total. The grand_total appears in the breakdown section
    // below (base + fees = grand_total). Showing grand_total here would
    // make it look like the total is being added ON TOP of the course price.
    : (order ? [{ subjectName: order.subjectName, amount: Number(order.baseAmount ?? order.amount), currency: order.currency }] : []);

  // v88 — fees breakdown (single-order mode only for now)
  // These come from the caller's props — but if the caller didn't pass
  // them (e.g., order created before v88, or caller uses a simplified
  // flow), we'll fetch them from the server in the useEffect below.
  const [feesData, setFeesData] = useState<{
    baseAmount?: number;
    feesTotal?: number;
    grandTotal?: number;
    feesBreakdown?: Array<{ code: string; name_ar: string; name_en: string; fee_kind: string; value: number; base_amount: number; calculated_amount: number }>;
  }>({});

  // Fetch the FULL order details (including fees_breakdown) from the
  // server when the dialog opens in single-order mode. This makes the
  // dialog self-sufficient — it doesn't depend on the caller passing
  // the fees fields through props (which was unreliable).
  useEffect(() => {
    if (!open || isMultiMode || !order?.orderId) {
      setFeesData({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const headers = await getCachedAuthHeaders();
        const res = await fetch(`/api/student/orders/${order!.orderId}`, { headers });
        const json = await res.json();
        if (cancelled || !json.success || !json.order) return;
        const o = json.order as {
          amount?: number | string;
          base_amount?: number | string | null;
          fees_total?: number | string | null;
          grand_total?: number | string | null;
          fees_breakdown?: Array<{ code: string; name_ar: string; name_en: string; fee_kind: string; value: number; base_amount: number; calculated_amount: number }>;
        };
        setFeesData({
          baseAmount: o.base_amount != null ? Number(o.base_amount) : undefined,
          feesTotal: o.fees_total != null ? Number(o.fees_total) : undefined,
          grandTotal: o.grand_total != null ? Number(o.grand_total) : undefined,
          feesBreakdown: o.fees_breakdown ?? [],
        });
      } catch {
        // Network error — fall back to props data
      }
    })();
    return () => { cancelled = true; };
  }, [open, isMultiMode, order?.orderId]);

  // Use fetched data if available, otherwise fall back to props.
  // v116: in MULTI-MODE, `order` is null + the useEffect above SKIPS
  // fetching feesData (because there's no single order_id to fetch).
  // That left baseSubtotal = 0 + feesBreakdown = [] → the breakdown
  // section showed "+0.00" and a misleading "no fees" message even
  // though the items DID carry per-order fee amounts (amount - base).
  //
  // Now: compute the multi-mode aggregates from the items themselves.
  // Each CheckoutSessionItem has:
  //   - amount       = order.amount (= grand_total = base + fees)
  //   - base_amount? = order.base_amount (the plan or subject price)
  //   - subject_price? = subjects.price (the original monthly catalog)
  // We sum base_amount (fallback subject_price → amount) to get the
  // base subtotal, and the residual (sum(amount) - sum(base)) becomes
  // the aggregate fees total. We also synthesize a single "رسوم إضافية"
  // row so the breakdown UI has something to render (instead of the
  // empty-state "+0.00" placeholder).
  const multiBaseFromSession = isMultiMode
    ? (sessionItems as CheckoutSessionItem[]).reduce((sum, it) => {
        const b = it.base_amount !== undefined ? Number(it.base_amount)
          : (it.subject_price !== undefined ? Number(it.subject_price) : Number(it.amount));
        return sum + b;
      }, 0)
    : 0;

  const multiGrandTotal = isMultiMode
    ? (sessionItems as CheckoutSessionItem[]).reduce((sum, it) => sum + Number(it.amount), 0)
    : 0;

  const multiFeesTotal = isMultiMode
    ? Math.max(0, multiGrandTotal - multiBaseFromSession)
    : 0;

  // Synthetic fees row for multi-mode (so the breakdown section doesn't
  // show the empty "+0.00" placeholder when there ARE fees aggregated).
  const multiFeesBreakdown = isMultiMode && multiFeesTotal > 0
    ? [{
        code: 'aggregated_fees',
        name_ar: 'رسوم إضافية',
        name_en: 'Additional fees',
        fee_kind: 'flat' as const,
        value: 0,
        base_amount: multiBaseFromSession,
        calculated_amount: multiFeesTotal,
      }]
    : [];

  const feesBreakdown = isMultiMode
    ? multiFeesBreakdown
    : (feesData.feesBreakdown ?? order?.feesBreakdown ?? []);
  const hasFees = feesBreakdown.length > 0;
  const baseSubtotal = isMultiMode ? multiBaseFromSession
    : (feesData.baseAmount ?? order?.baseAmount ?? Number(order?.amount ?? 0));
  const feesTotal = isMultiMode ? multiFeesTotal
    : (feesData.feesTotal ?? order?.feesTotal ?? 0);
  const grandTotal = isMultiMode
    ? multiGrandTotal
    : (feesData.grandTotal ?? order?.grandTotal ?? Number(order?.amount ?? 0));

  const totalAmount = useMemo(
    () => isMultiMode ? multiGrandTotal : grandTotal,
    [isMultiMode, multiGrandTotal, grandTotal],
  );
  const currency = items[0]?.currency ?? 'EGP';

  const handlePayNow = useCallback(async () => {
    if (state === 'preparing' || state === 'redirecting' || state === 'fawry_pending') return; // prevent double-click
    setState('preparing');
    setErrorMessage(null);
    try {
      const headers = await getCachedAuthHeaders();
      const result = isMultiMode
        ? await initiateSessionPayment(sessionId as string, headers, paymentMethod)
        : await initiatePayment((order as PaymentSummaryOrder).orderId, headers, paymentMethod);

      // v88+ — Fawry Code path: the adapter returns a reference code
      // (no checkoutUrl). Display it + poll for payment status.
      if (result.provider === 'fawry' || result.metadata?.referenceCode) {
        const refCode = result.paymentReference || result.metadata?.referenceCode || '';
        setFawryReferenceCode(String(refCode));
        setState('fawry_pending');
        return; // don't redirect — stay on the dialog
      }

      // Successfully received a checkout URL — begin the redirect state.
      // The browser is about to navigate away; the dialog stays open
      // in the "redirecting" state until the page actually unloads.
      setState('redirecting');
      const didRedirect = redirectToCheckout(result.checkoutUrl);
      if (!didRedirect) {
        // SSR or no window — shouldn't happen in a 'use client' component,
        // but we handle it gracefully.
        throw new PaymentActionError(
          'NETWORK_ERROR',
          'window unavailable — cannot redirect to checkout',
        );
      }
      // If we got here, the browser is navigating away. The dialog
      // stays open in the "redirecting" state until the page unloads.
    } catch (err) {
      const message = err instanceof PaymentActionError
        ? getPaymentActionErrorMessage(err, t('student.payment.paymentInitFailed'))
        : (err instanceof Error ? err.message : t('student.payment.paymentInitFailed'));
      setErrorMessage(message);
      toast.error(message);
      setState('error');
    }
  }, [state, isMultiMode, sessionId, order, t, paymentMethod]);

  // v88+ — Poll the order status while in 'fawry_pending' state.
  // The student paid at a Fawry machine → Fawry sends a webhook →
  // the order flips to 'paid' → the polling detects it + closes the
  // dialog + reloads to show the now-active enrollment.
  useEffect(() => {
    if (state !== 'fawry_pending') return;
    const orderIdToPoll = isMultiMode ? null : (order as PaymentSummaryOrder)?.orderId;
    if (!orderIdToPoll) return; // multi-session: no per-order polling for now

    const interval = setInterval(async () => {
      try {
        const headers = await getCachedAuthHeaders();
        const res = await fetch(`/api/student/orders/${orderIdToPoll}`, { headers });
        const json = await res.json();
        if (json.success && json.order?.status === 'paid') {
          clearInterval(interval);
          toast.success('تم الدفع بنجاح! تفعيل الاشتراك...');
          setState('ready');
          // Reload the page so the student sees the now-active enrollment
          if (typeof window !== 'undefined') {
            setTimeout(() => window.location.reload(), 800);
          }
        } else {
          setFawryPollCount((c) => c + 1);
        }
      } catch {
        // Network blip — keep polling
        setFawryPollCount((c) => c + 1);
      }
    }, 30_000); // 30s

    return () => clearInterval(interval);
  }, [state, isMultiMode, order]);

  // Reset state when dialog closes
  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      // Only allow closing if not in the middle of redirecting
      // (otherwise the user could close mid-navigation, which is OK
      // but we want to discourage it).
      if (state === 'redirecting') return; // can't close mid-redirect
      setState('ready');
      setErrorMessage(null);
      setFawryReferenceCode(null);
      setFawryPollCount(0);
    }
    onOpenChange(next);
  }, [state, onOpenChange]);

  // ─── Remove item from multi-session (Fix 2) ───
  // Calls removeCheckoutSessionItem(sessionId, orderId) → server
  // validates ownership + session membership + pending status +
  // payment-not-initiated, then updates orders.checkout_session_id=NULL.
  // On success, updates the parent's sessionItems via onSessionItemsChange.
  // If 0 items remain, closes the dialog.
  const handleRemoveItem = useCallback(async (orderId: string) => {
    if (!isMultiMode || !sessionId || !onSessionItemsChange) return;
    if (removingOrderId) return; // prevent double-click
    setRemovingOrderId(orderId);
    try {
      const headers = await getCachedAuthHeaders();
      const result = await removeCheckoutSessionItem(sessionId, orderId, headers);
      // Update the parent's sessionItems state
      onSessionItemsChange(result.items);
      if (result.items.length === 0) {
        // No items left → close the dialog
        toast.info(t('student.payment.sessionEmptied'));
        handleOpenChange(false);
      } else {
        toast.success(t('student.payment.itemRemoved'));
      }
    } catch (err) {
      const message = err instanceof PaymentActionError
        ? getPaymentActionErrorMessage(err, t('student.payment.paymentInitFailed'))
        : (err instanceof Error ? err.message : t('student.payment.paymentInitFailed'));
      toast.error(message);
    } finally {
      setRemovingOrderId(null);
    }
  }, [isMultiMode, sessionId, onSessionItemsChange, removingOrderId, t, handleOpenChange]);

  if (!order && !isMultiMode) {
    return null;
  }

  if (items.length === 0) {
    return null;
  }

  const stateLabel =
    state === 'preparing' ? t('student.payment.initializingPayment')
    : state === 'redirecting' ? t('student.payment.redirecting')
    : state === 'fawry_pending' ? 'في انتظار الدفع عبر فوري'
    : state === 'error' ? t('student.payment.paymentFailed')
    : t('student.payment.readyToPay');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={isMultiMode ? "sm:max-w-lg max-h-[90vh] overflow-y-auto" : "sm:max-w-md max-h-[90vh] overflow-y-auto"}
        dir={direction}
      >
        <DialogHeader className="text-end">
          <DialogTitle className="flex items-center gap-2 justify-end text-end">
            <CreditCard className="h-5 w-5 text-teal-600" />
            {isMultiMode ? t('student.payment.orderSummary') : t('student.payment.paymentSummary')}
          </DialogTitle>
          <DialogDescription>
            {t('student.payment.paymentSummaryDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* Items list (server-authoritative values) */}
        <div className="space-y-2 py-2">
          {items.map((it, i) => {
            // For multi-mode, find the original CheckoutSessionItem
            // (which has order_id) so we can pass it to handleRemoveItem.
            const sessionItem = isMultiMode
              ? (sessionItems as CheckoutSessionItem[])[i]
              : null;
            const orderId = sessionItem?.order_id;
            const canRemove = isMultiMode && !!orderId && !!onSessionItemsChange && state === 'ready';
            const isRemoving = removingOrderId === orderId;
            return (
              <div key={i} className="flex items-start justify-between gap-3 border-b pb-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-end break-words">
                    {it.subjectName}
                  </div>
                  {/* v116: show original course catalog price when it differs
                      from the actual charged amount (e.g., when a non-default
                      plan was selected). */}
                  {it.subjectPrice !== undefined && it.subjectPrice !== it.amount && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 line-through decoration-muted-foreground/40">
                      أصل سعر المقرر: {Number(it.subjectPrice).toFixed(2)} {it.currency}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t('student.payment.monthlySubscription')}
                  </div>
                </div>
                <div className="text-end shrink-0 flex items-center gap-2">
                  <span className="text-sm font-mono">
                    {Number(it.amount).toFixed(2)} {it.currency}
                  </span>
                  {/* Remove button (multi-mode only, before payment initiation) */}
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => orderId && handleRemoveItem(orderId)}
                      disabled={isRemoving}
                      title={t('student.payment.removeItem')}
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={t('student.payment.removeItem')}
                    >
                      {isRemoving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Item count (multi-mode) */}
          {isMultiMode && (
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-sm text-muted-foreground">
                {t('student.payment.itemCount')}
              </span>
              <Badge variant="secondary" className="text-xs">
                {items.length} {t('student.payment.coursesLabel')}
              </Badge>
            </div>
          )}

          {/* Payment method picker — student chooses Card or Mobile Wallet */}
          <div className="space-y-2 py-2 border-b">
            <span className="text-sm text-muted-foreground">
              {t('student.payment.paymentMethod')}
            </span>
            <div className="grid grid-cols-3 gap-2">
              {/* Card option */}
              <button
                type="button"
                onClick={() => setPaymentMethod('card')}
                disabled={state === 'preparing' || state === 'redirecting' || state === 'fawry_pending'}
                className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-start transition-colors ${
                  paymentMethod === 'card'
                    ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/15 ring-1 ring-teal-500'
                    : 'border-muted hover:border-teal-400 hover:bg-muted/30'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-1.5">
                  <CreditCard className={`h-4 w-4 ${paymentMethod === 'card' ? 'text-teal-700 dark:text-teal-300' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">كارت</span>
                </div>
                <span className="text-xs text-muted-foreground">Visa / Mastercard</span>
              </button>
              {/* v113: removed wallet option per user request */}
              {/* Fawry option */}
              <button
                type="button"
                onClick={() => setPaymentMethod('fawry')}
                disabled={state === 'preparing' || state === 'redirecting' || state === 'fawry_pending'}
                className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-start transition-colors ${
                  paymentMethod === 'fawry'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/15 ring-1 ring-amber-500'
                    : 'border-muted hover:border-amber-400 hover:bg-muted/30'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-1.5">
                  <Banknote className={`h-4 w-4 ${paymentMethod === 'fawry' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-medium">فوري</span>
                </div>
                <span className="text-xs text-muted-foreground">كود دفع — أي ماكينة</span>
              </button>
            </div>
          </div>

          {/* v110 — Payment details breakdown (show in BOTH single and multi mode) */}
          <div className="space-y-1 text-xs border-t border-b border-sky-200 dark:border-sky-900/40 py-2 my-2 bg-sky-50/50 dark:bg-sky-900/10 rounded-md px-3">
            {/* Base subscription price */}
            <div className="flex justify-between font-medium text-foreground">
              <span>السعر الأساسي للاشتراك</span>
              <span className="font-mono">{baseSubtotal.toFixed(2)} {currency}</span>
            </div>
            {/* Fees breakdown (tax, VAT, platform commission, etc.) */}
            {feesBreakdown.length > 0 ? (
              feesBreakdown.map((fee, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <span>
                    {fee.name_ar}{' '}
                    <span className="text-[10px] text-muted-foreground/70">
                      ({fee.fee_kind === 'percentage' ? `${fee.value}%` : `${fee.value} ${currency}`})
                    </span>
                  </span>
                  <span className="font-mono">+{fee.calculated_amount.toFixed(2)} {currency}</span>
                </div>
              ))
            ) : (
              <div className="flex justify-between text-muted-foreground/60">
                <span>لا توجد رسوم إضافية</span>
                <span className="font-mono">+0.00 {currency}</span>
              </div>
            )}
            {/* Grand total */}
            <div className="border-t border-sky-200 dark:border-sky-900/40 pt-1 mt-1 flex justify-between font-semibold text-teal-800 dark:text-teal-200">
              <span>المجموع الكلي (يُرسل لبوابة الدفع)</span>
              <span className="font-mono">{grandTotal.toFixed(2)} {currency}</span>
            </div>
          </div>

          {/* Total — prominent */}
          <div className="flex items-center justify-between bg-teal-50 dark:bg-teal-900/15 rounded-md p-3 border border-teal-200 dark:border-teal-900/40">
            <span className="text-sm font-semibold text-teal-800 dark:text-teal-200">
              {t('student.payment.total')}
            </span>
            <span className="text-xl font-bold text-teal-700 dark:text-teal-300 font-mono">
              {totalAmount.toFixed(2)} {currency}
            </span>
          </div>

          {/* Pending hint */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-900/30 rounded-md p-2">
            <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
            <span className="leading-relaxed">
              {t('student.payment.pendingOrderHint')}
            </span>
          </div>

          {/* State label */}
          {state !== 'ready' && state !== 'error' && (
            <div className="flex items-center justify-center gap-2 text-xs text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/15 border border-sky-200 dark:border-sky-900/30 rounded-md p-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{stateLabel}</span>
            </div>
          )}

          {/* Error display (categorized Arabic message) */}
          {state === 'error' && errorMessage && (
            <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/15 border border-rose-200 dark:border-rose-900/30 rounded-md p-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* v88+ — Fawry Code display */}
          {state === 'fawry_pending' && fawryReferenceCode && (
            <div className="space-y-3 border-2 border-amber-300 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/15 rounded-lg p-4">
              <div className="text-center">
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">
                  كود الدفع عبر فوري
                </h4>
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                  خذ الكود ده لاقرب ماكينة فوري أو تطبيق فوري وادفع المبلغ خلال 24 ساعة
                </p>
                <div className="bg-white dark:bg-amber-950/40 rounded-md py-4 px-2 border-2 border-dashed border-amber-400 dark:border-amber-700">
                  <code className="text-3xl font-bold font-mono tracking-[0.15em] text-amber-900 dark:text-amber-100 select-all" dir="ltr">
                    {fawryReferenceCode}
                  </code>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 gap-1 text-xs"
                  onClick={() => {
                    navigator.clipboard?.writeText(fawryReferenceCode);
                    toast.success('تم نسخ الكود');
                  }}
                >
                  نسخ الكود
                </Button>
              </div>

              <div className="text-xs space-y-1 border-t border-amber-200 dark:border-amber-900/40 pt-2">
                <div className="flex justify-between text-amber-800 dark:text-amber-200">
                  <span>المبلغ المطلوب:</span>
                  <span className="font-mono font-bold">{totalAmount.toFixed(2)} {currency}</span>
                </div>
                <div className="flex justify-between text-amber-700 dark:text-amber-300">
                  <span>الحالة:</span>
                  <span>⏳ في انتظار الدفع — سيتم التفعيل تلقائياً بعد الدفع</span>
                </div>
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>عدد مرات التحقق:</span>
                  <span>{fawryPollCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button
            onClick={handlePayNow}
            disabled={state === 'preparing' || state === 'redirecting'}
            className="bg-teal-600 hover:bg-teal-700 text-white flex-1 sm:flex-none"
          >
            {state === 'preparing' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('student.payment.initializingPayment')}
              </>
            ) : state === 'redirecting' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('student.payment.redirecting')}
              </>
            ) : (
              <>
                <CreditCard className="h-4 w-4" />
                {t('student.payment.payNow')}
              </>
            )}
          </Button>
          <DialogClose asChild>
            <Button
              variant="outline"
              disabled={state === 'preparing' || state === 'redirecting'}
              onClick={() => handleOpenChange(false)}
            >
              {t('student.payment.cancel')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PaymentSummaryDialog;
