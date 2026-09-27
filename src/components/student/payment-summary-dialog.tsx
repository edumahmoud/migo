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

import { useState, useCallback, useMemo } from 'react';
import { Loader2, CreditCard, X, AlertCircle, ShieldCheck, ExternalLink } from 'lucide-react';
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
}

type PaymentState = 'ready' | 'preparing' | 'redirecting' | 'error';

export function PaymentSummaryDialog({
  open,
  onOpenChange,
  order,
  sessionItems,
  sessionId,
}: PaymentSummaryDialogProps) {
  const { t, direction } = useTranslations();
  const [state, setState] = useState<PaymentState>('ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Determine mode + items to display
  const isMultiMode = !order && Array.isArray(sessionItems) && sessionItems.length > 0 && !!sessionId;
  const items: Array<{ subjectName: string; amount: number; currency: string }> = isMultiMode
    ? (sessionItems as CheckoutSessionItem[]).map((it) => ({
        subjectName: it.subject_name,
        amount: Number(it.amount),
        currency: it.currency,
      }))
    : (order ? [{ subjectName: order.subjectName, amount: Number(order.amount), currency: order.currency }] : []);

  const totalAmount = useMemo(
    () => items.reduce((sum, it) => sum + Number(it.amount), 0),
    [items],
  );
  const currency = items[0]?.currency ?? 'EGP';

  const handlePayNow = useCallback(async () => {
    if (state === 'preparing' || state === 'redirecting') return; // prevent double-click
    setState('preparing');
    setErrorMessage(null);
    try {
      const headers = await getCachedAuthHeaders();
      const result = isMultiMode
        ? await initiateSessionPayment(sessionId as string, headers)
        : await initiatePayment((order as PaymentSummaryOrder).orderId, headers);

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
  }, [state, isMultiMode, sessionId, order, t]);

  // Reset state when dialog closes
  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      // Only allow closing if not in the middle of redirecting
      // (otherwise the user could close mid-navigation, which is OK
      // but we want to discourage it).
      if (state === 'redirecting') return; // can't close mid-redirect
      setState('ready');
      setErrorMessage(null);
    }
    onOpenChange(next);
  }, [state, onOpenChange]);

  if (!order && !isMultiMode) {
    return null;
  }

  if (items.length === 0) {
    return null;
  }

  const stateLabel =
    state === 'preparing' ? t('student.payment.initializingPayment')
    : state === 'redirecting' ? t('student.payment.redirecting')
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
          {items.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b pb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-end break-words">
                  {it.subjectName}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t('student.payment.monthlySubscription')}
                </div>
              </div>
              <div className="text-end shrink-0">
                <span className="text-sm font-mono">
                  {Number(it.amount).toFixed(2)} {it.currency}
                </span>
              </div>
            </div>
          ))}

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

          {/* Payment method */}
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">
              {t('student.payment.paymentMethod')}
            </span>
            <span className="text-sm font-medium text-end">
              {t('student.payment.paymentMethodValue')}
            </span>
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
