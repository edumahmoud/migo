'use client';

/**
 * Payment Summary Dialog — Student Checkout UI
 *
 * Reusable dialog shown BEFORE a student confirms payment for a paid
 * course order. The dialog:
 *   1. Displays the server-authoritative order info (subject name,
 *      monthly duration, price, currency, total, payment method).
 *   2. Has a "Pay Now" button that calls the EXISTING backend endpoint
 *      POST /api/student/orders/[id]/pay (via the pure helper
 *      src/lib/student/payment-action.ts).
 *   3. On success, redirects the browser to the Paymob hosted-checkout
 *      URL (window.location.href — external navigation, not Next router).
 *   4. On failure, shows a clear error toast + keeps the order pending
 *      (no client-side "mark as paid" ever happens).
 *
 * The dialog is REUSED by:
 *   - subjects-section.tsx (new-order flow): after creating a pending
 *     order via POST /api/student/orders, opens the dialog with the new
 *     order ID + course info.
 *   - student-activation-page.tsx (existing-order flow): when a student
 *     clicks "Complete Payment" on a pending order in the "قيد الدفع"
 *     list, opens the dialog with that order's ID + course info — no
 *     new order is created.
 *
 * SECURITY:
 *   - The dialog never trusts a client-supplied price/currency/student_id.
 *     It displays the values that came from the server response (the
 *     POST /api/student/orders response, or the existing pending order's
 *     row from the activation page).
 *   - The dialog never directly marks an order as paid. Only the Paymob
 *     webhook (server-to-server) can transition orders to 'paid'.
 *   - No Paymob secrets/credentials/tokens are exposed to the client.
 *     The dialog only ever receives the public checkout_url from the
 *     backend's authenticated endpoint.
 *
 * Accessibility:
 *   - Built on the existing src/components/ui/dialog (Radix-based).
 *   - Keyboard accessible (Tab cycle, Esc to close — Radix default).
 *   - dir="rtl" | "ltr" follows the project's i18n direction.
 *   - Close button + Cancel button both clearly labelled.
 *
 * Idempotency:
 *   - The "Pay Now" button is disabled while a payment is being initiated
 *     (prevents duplicate /pay requests from rapid double-clicks).
 *   - The backend endpoint is itself idempotent — if the order already
 *     has a provider_order_ref, it verifies the existing intention's
 *     status instead of creating a duplicate Paymob intention.
 */

import { useState, useCallback } from 'react';
import { Loader2, CreditCard, X, AlertCircle, ShieldCheck } from 'lucide-react';
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
  redirectToCheckout,
  PaymentActionError,
} from '@/lib/student/payment-action';

// ─── Types ───
export interface PaymentSummaryOrder {
  /** The order ID returned by POST /api/student/orders (created_orders[].id). */
  orderId: string;
  /** Subject name (server-authoritative — from the order's subject row). */
  subjectName: string;
  /** Subscription amount (server-authoritative — from the order's amount). */
  amount: number;
  /** Currency code (server-authoritative — from the order's currency). */
  currency: string;
}

interface PaymentSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PaymentSummaryOrder | null;
}

// ─── Component ───
export function PaymentSummaryDialog({
  open,
  onOpenChange,
  order,
}: PaymentSummaryDialogProps) {
  const { t, direction } = useTranslations();
  const [initiating, setInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePayNow = useCallback(async () => {
    if (!order || initiating) return;
    setInitiating(true);
    setError(null);
    try {
      const headers = await getCachedAuthHeaders();
      const result = await initiatePayment(order.orderId, headers);
      // Successfully received a checkout_url — redirect the browser
      // to Paymob's hosted checkout. This is a full-page navigation
      // AWAY from the app (external URL).
      const didRedirect = redirectToCheckout(result.checkoutUrl);
      if (!didRedirect) {
        // SSR or no window — shouldn't happen in a 'use client' component,
        // but we handle it gracefully.
        throw new PaymentActionError(
          'NETWORK_ERROR',
          'window unavailable — cannot redirect to checkout',
        );
      }
      // If we got here, the browser is navigating away. The dialog stays
      // open in the loading state until the page actually unloads.
    } catch (err) {
      const message = err instanceof PaymentActionError
        ? err.message
        : (err instanceof Error ? err.message : 'Unknown error');
      setError(message);
      toast.error(t('student.payment.paymentInitFailed'));
      setInitiating(false);
    }
  }, [order, initiating, t]);

  // Reset error + loading state when the dialog closes
  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      // Closing — only allow if not in the middle of initiating
      // (otherwise the user could close mid-redirect)
      if (initiating) return;
      setError(null);
    }
    onOpenChange(next);
  }, [initiating, onOpenChange]);

  if (!order) {
    return null;
  }

  const amount = Number(order.amount) || 0;
  const currency = order.currency || 'EGP';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        dir={direction}
      >
        <DialogHeader className="text-end">
          <DialogTitle className="flex items-center gap-2 justify-end text-end">
            <CreditCard className="h-5 w-5 text-teal-600" />
            {t('student.payment.paymentSummary')}
          </DialogTitle>
          <DialogDescription>
            {t('student.payment.paymentSummaryDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* Order details — server-authoritative values */}
        <div className="space-y-3 py-2">
          {/* Course name */}
          <div className="flex items-start justify-between gap-3 border-b pb-2">
            <span className="text-sm text-muted-foreground">
              {t('student.payment.course')}
            </span>
            <span className="text-sm font-medium text-end break-words">
              {order.subjectName}
            </span>
          </div>

          {/* Subscription duration */}
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">
              {t('student.payment.subscriptionDuration')}
            </span>
            <Badge variant="secondary" className="text-xs">
              {t('student.payment.oneMonth')}
            </Badge>
          </div>

          {/* Amount */}
          <div className="flex items-center justify-between border-b pb-2">
            <span className="text-sm text-muted-foreground">
              {t('student.payment.amount')}
            </span>
            <span className="text-sm font-mono">
              {amount.toFixed(2)} {currency}
            </span>
          </div>

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
              {amount.toFixed(2)} {currency}
            </span>
          </div>

          {/* Pending hint */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-900/30 rounded-md p-2">
            <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
            <span className="leading-relaxed">
              {t('student.payment.pendingOrderHint')}
            </span>
          </div>

          {/* Error display (if any) */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/15 border border-rose-200 dark:border-rose-900/30 rounded-md p-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button
            onClick={handlePayNow}
            disabled={initiating}
            className="bg-teal-600 hover:bg-teal-700 text-white flex-1 sm:flex-none"
          >
            {initiating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('student.payment.initializingPayment')}
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
              disabled={initiating}
              onClick={() => handleOpenChange(false)}
            >
              {t('student.payment.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PaymentSummaryDialog;
