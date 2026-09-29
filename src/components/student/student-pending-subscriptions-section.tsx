'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Clock, RefreshCw, Inbox, BookOpen, CreditCard, AlertCircle, Search, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import { generatePaymentCode } from '@/lib/payment/utils';
import PaymentCodeSearchBox from '@/components/shared/payment-code-search-box';
import type { UserProfile } from '@/lib/types';

interface PendingOrder {
  id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  checkout_session_id: string | null;
  created_at: string;
  subject: { id: string; name: string; price: number } | null;
}

interface StudentPendingSubscriptionsSectionProps {
  profile: UserProfile;
}

/**
 * Student's Pending Subscriptions section.
 *
 * Shows all the student's orders with status='pending' (subscriptions
 * the student created but haven't been activated yet).
 *
 * Each row shows:
 *   - Subject name
 *   - Amount + currency
 *   - Created date
 *   - "Pay Now" button → /api/student/orders/[id]/pay (redirect to Paymob)
 *   - "Cancel" button → /api/student/orders/[id]/cancel (if they want to delete)
 *
 * After payment + redirect, the student's verify-after-redirect flow
 * fires automatically and the order becomes 'paid' (disappears from
 * this list).
 */
export default function StudentPendingSubscriptionsSection({ profile }: StudentPendingSubscriptionsSectionProps) {
  const { t } = useTranslations();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningOrderId, setActioningOrderId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      // Use the browser-side Supabase client (anon key + RLS)
      // Students can read their own orders via the orders_student_read policy
      const { supabase } = await import('@/lib/supabase');
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, subject_id, amount, currency, status,
          provider_order_ref, checkout_session_id, created_at,
          subject:subject_id (id, name, price)
        `)
        .eq('student_id', profile.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[pending-subs] fetch error:', error);
        toast.error('تعذّر جلب الاشتراكات المعلّقة');
      } else {
        setOrders((data ?? []) as unknown as PendingOrder[]);
      }
    } catch (err) {
      console.error('[pending-subs] fetch failed:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Pay now → redirect to Paymob
  // Only shown when payment hasn't been initiated yet (no provider_order_ref)
  // Handles TWO cases:
  //   1. Single-order pay: POST /api/student/orders/[id]/pay
  //   2. Multi-subject session pay (when order.checkout_session_id is set):
  //      POST /api/student/checkout/sessions/[sessionId]/pay
  // The single-order endpoint returns 409 PART_OF_SESSION for session
  // orders — we detect this and retry via the session endpoint.
  const payNow = async (orderId: string, checkoutSessionId?: string | null) => {
    if (actioningOrderId) return;
    setActioningOrderId(orderId);
    try {
      const headers = await getCachedAuthHeaders();

      // ── If the order is part of a multi-subject checkout session,
      // use the session pay endpoint directly (skip the 409 retry dance).
      if (checkoutSessionId) {
        const sessionRes = await fetch(`/api/student/checkout/sessions/${checkoutSessionId}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
        });
        const sessionJson = await sessionRes.json();
        if (sessionJson.success && sessionJson.checkout_url) {
          window.location.href = sessionJson.checkout_url;
          return;
        }
        toast.error(sessionJson.error || 'تعذّر تجهيز الدفعة الموحدة');
        return;
      }

      // ── Single-order pay
      const res = await fetch(`/api/student/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      });
      const json = await res.json();

      // ── Handle 409 PART_OF_SESSION — retry via the session endpoint
      if (res.status === 409 && json.category === 'PART_OF_SESSION' && json.session_id) {
        console.info('[pending-subs] order is part of session — retrying via session endpoint', {
          session_id: json.session_id,
        });
        const sessionRes = await fetch(`/api/student/checkout/sessions/${json.session_id}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
        });
        const sessionJson = await sessionRes.json();
        if (sessionJson.success && sessionJson.checkout_url) {
          window.location.href = sessionJson.checkout_url;
          return;
        }
        toast.error(sessionJson.error || 'تعذّر تجهيز الدفعة الموحدة');
        return;
      }

      if (json.success && json.checkout_url) {
        // Redirect to Paymob
        window.location.href = json.checkout_url;
      } else {
        // Show the actual server error to the user
        toast.error(json.error || `تعذّر تجهيز الدفعة (HTTP ${res.status})`);
      }
    } catch (err) {
      console.error('[pending-subs] pay failed:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningOrderId(null);
    }
  };

  // Check payment status → calls verify-after-redirect
  // Shown when payment was already initiated (provider_order_ref is numeric)
  // Verifies with Paymob + activates the subscription if paid
  const checkPaymentStatus = async (orderId: string, providerOrderRef: string) => {
    if (actioningOrderId) return;
    setActioningOrderId(orderId);
    try {
      const headers = await getCachedAuthHeaders();
      // Use providerOrderRef (Paymob's transaction/order ID) as the
      // transactionId for the verify-after-redirect endpoint
      const res = await fetch('/api/student/orders/verify-after-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          transactionId: providerOrderRef,
          merchantOrderId: orderId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم تفعيل اشتراكك بنجاح');
        // Refresh the list (the order should be gone now)
        await fetchOrders();
        // Force a page reload after 2s so the student sees the activated course
        setTimeout(() => window.location.reload(), 2000);
      } else if (json.pending) {
        toast.info('العملية لسه قيد المعالجة — حاول تاني بعد 30 ثانية');
      } else {
        toast.error(json.error || 'تعذّر التحقق من الدفعة — تأكد إنك خلّصت الدفع على Paymob');
      }
    } catch (err) {
      console.error('[pending-subs] check status failed:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningOrderId(null);
    }
  };

  // Copy payment code to clipboard
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`تم نسخ الكود: ${code}`);
    } catch {
      toast.error('تعذّر نسخ الكود');
    }
  };

  // Refresh list
  const handleRefresh = async () => {
    await fetchOrders();
    toast.success('تم تحديث القائمة');
  };

  return (
    <div className="space-y-4 p-3 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-start gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shrink-0">
          <Clock className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">الاشتراكات المعلّقة</h1>
          <p className="text-sm text-muted-foreground">
            المقررات اللي اخترتها بس لسه متفعّلتش — ادفع دلوقتي عشان تتفعّل تلقائياً.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          تحديث
        </Button>
      </header>

      {/* Search box — search by payment code */}
      <PaymentCodeSearchBox />

      {/* Stats card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Inbox className="h-8 w-8 text-amber-600" />
            <div>
              <div className="text-2xl font-bold">{orders.length}</div>
              <div className="text-xs text-muted-foreground">اشتراك معلّق</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending orders list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الطلبات المعلّقة</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                لا توجد اشتراكات معلّقة حاليًا. كل مقرراتك مفعّلة.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {orders.map((o) => {
                // Determine if payment was already initiated (provider_order_ref is set + numeric)
                const paymentInitiated = !!o.provider_order_ref && /^\d+$/.test(o.provider_order_ref);
                // Generate the human-readable payment code from the order UUID
                const paymentCode = generatePaymentCode(o.id);
                return (
                  <div
                    key={o.id}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30 flex-wrap"
                  >
                    {/* Left: subject info + payment code */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <BookOpen className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">
                            {o.subject?.name ?? 'مقرر غير معروف'}
                          </span>
                          <Badge variant="secondary" className="text-xs">قيد الدفع</Badge>
                          {o.checkout_session_id && (
                            <Badge variant="outline" className="text-xs">دفعة موحدة</Badge>
                          )}
                        </div>
                        {/* Payment code — copyable */}
                        <button
                          type="button"
                          onClick={() => copyCode(paymentCode)}
                          className="text-xs font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1 self-start"
                          title="اضغط للنسخ"
                        >
                          <span className="font-bold">كود العملية:</span>
                          <span className="bg-sky-50 dark:bg-sky-900/20 px-1.5 py-0.5 rounded">
                            {paymentCode}
                          </span>
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {new Date(o.created_at).toLocaleString('ar-EG')}
                        </div>
                        {paymentInitiated && (
                          <div className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1 mt-1">
                            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>
                              تم الدفع على Paymob — اضغط "تحقق من الدفعة" عشان نفعل اشتراكك تلقائياً.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: amount + action */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-end">
                        <div className="text-sm font-mono font-semibold">
                          {Number(o.amount).toFixed(2)} {o.currency}
                        </div>
                      </div>
                      {paymentInitiated ? (
                        // Payment was already initiated on Paymob →
                        // Show a "بانتظار التأكيد" badge (no more "Pay Now")
                        // + a "تحقق من الدفعة" button that verifies + activates
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15">
                            بانتظار التأكيد من Paymob
                          </Badge>
                          <Button
                            size="sm"
                            className="h-8 px-3 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={actioningOrderId === o.id}
                            onClick={() => o.provider_order_ref && checkPaymentStatus(o.id, o.provider_order_ref)}
                            title="تحقق من حالة الدفعة عند Paymob"
                          >
                            {actioningOrderId === o.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            تحقق من الدفعة
                          </Button>
                        </div>
                      ) : (
                        // Payment NOT initiated → show "ادفع دلوقتي"
                        <Button
                          size="sm"
                          className="h-8 px-3 text-xs gap-1 bg-teal-600 hover:bg-teal-700 text-white"
                          disabled={actioningOrderId === o.id}
                          onClick={() => payNow(o.id, o.checkout_session_id)}
                          title="ادفع دلوقتي"
                        >
                          {actioningOrderId === o.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CreditCard className="h-3.5 w-3.5" />
                          )}
                          ادفع دلوقتي
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
