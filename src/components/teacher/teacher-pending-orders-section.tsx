'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Ban, BadgeCheck, Clock, RefreshCw, Inbox, User, BookOpen, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { generatePaymentCode } from '@/lib/payment/utils';
import PaymentCodeSearchBox from '@/components/shared/payment-code-search-box';
import type { UserProfile } from '@/lib/types';

interface PendingOrder {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  checkout_session_id: string | null;
  created_at: string;
  subject: { id: string; name: string } | null;
  student: { id: string; name: string | null; email: string; student_code: string | null } | null;
}

interface TeacherPendingOrdersSectionProps {
  profile: UserProfile;
}

/**
 * Teacher's Pending Orders section.
 *
 * Lists all pending orders for the teacher's subjects. Each row has:
 *   - student name + code
 *   - subject name
 *   - amount + currency
 *   - created_at
 *   - "تفعيل" button (manual activation when payment received outside the system)
 *   - "إلغاء" button (cancel the order)
 *
 * On activate/cancel success, the list is refreshed.
 */
export default function TeacherPendingOrdersSection({ profile }: TeacherPendingOrdersSectionProps) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningOrderId, setActioningOrderId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher/orders', {
        headers: { ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        setOrders(json.orders ?? []);
      } else {
        toast.error(json.error || 'تعذّر جلب الطلبات المعلّقة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Activate a pending order manually (payment received outside the system)
  const activateOrder = async (orderId: string) => {
    if (actioningOrderId) return;
    if (!confirm('تأكيد: تم استلام المبلغ من الطالب خارج النظام؟ سيتم تفعيل الاشتراك يدويًا.')) return;
    setActioningOrderId(orderId);
    try {
      const res = await fetch('/api/teacher/subscriptions/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم تفعيل الاشتراك');
        await fetchOrders(); // refresh
      } else {
        toast.error(json.error || 'فشل التفعيل');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningOrderId(null);
    }
  };

  // Cancel a pending order
  const cancelOrder = async (orderId: string) => {
    if (actioningOrderId) return;
    if (!confirm('تأكيد: إلغاء هذا الطلب المعلّق؟ يمكن للطالب إنشاء طلب جديد بعد ذلك.')) return;
    setActioningOrderId(orderId);
    try {
      const res = await fetch(`/api/teacher/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إلغاء الطلب');
        await fetchOrders(); // refresh
      } else {
        toast.error(json.error || 'فشل الإلغاء');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningOrderId(null);
    }
  };

  return (
    <div className="space-y-4 p-3 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex items-start gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shrink-0">
          <Clock className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">الطلبات المعلّقة</h1>
          <p className="text-sm text-muted-foreground">
            عرض كل الطلبات المعلّقة لطلابك. يمكنك تفعيل الاشتراك يدويًا (لو استلمت المبلغ خارج النظام) أو إلغاء الطلب.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchOrders} disabled={loading}>
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
              <div className="text-xs text-muted-foreground">طلب معلّق</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الطلبات</CardTitle>
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
                لا توجد طلبات معلّقة حاليًا. سيظهر هنا أي طلب جديد ينشئه طالب ولم يدفع بعد.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {orders.map((o) => (
                <div
                  key={o.id}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30 flex-wrap"
                >
                  {/* Left: student + subject info */}
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="flex flex-col gap-1 min-w-0">
                      {/* Student */}
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">
                          {o.student?.name ?? '—'}
                        </span>
                        {o.student?.student_code && (
                          <Badge variant="outline" className="text-xs font-mono">
                            {o.student.student_code}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground" dir="ltr">
                          {o.student?.email}
                        </span>
                      </div>
                      {/* Subject */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <BookOpen className="h-3 w-3 shrink-0" />
                        <span className="truncate">{o.subject?.name ?? '—'}</span>
                        <span>·</span>
                        <span>{new Date(o.created_at).toLocaleString('ar-EG')}</span>
                        {o.checkout_session_id && (
                          <Badge variant="secondary" className="text-xs">
                            جزء من دفعة موحدة
                          </Badge>
                        )}
                      </div>
                      {/* Payment code — copyable */}
                      <button
                        type="button"
                        onClick={async () => {
                          const code = generatePaymentCode(o.id);
                          try {
                            await navigator.clipboard.writeText(code);
                            toast.success(`تم نسخ الكود: ${code}`);
                          } catch {
                            toast.error('تعذّر نسخ الكود');
                          }
                        }}
                        className="text-xs font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1 self-start"
                        title="اضغط للنسخ"
                      >
                        <span className="font-bold">كود العملية:</span>
                        <span className="bg-sky-50 dark:bg-sky-900/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                          {generatePaymentCode(o.id)}
                          <Copy className="h-2.5 w-2.5" />
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Right: amount + actions */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <div className="text-end">
                      <div className="text-sm font-mono font-semibold">
                        {Number(o.amount).toFixed(2)} {o.currency}
                      </div>
                    </div>
                    {/* If payment was initiated on Paymob (provider_order_ref is numeric),
                        show a clear "تم الدفع على Paymob" badge so the teacher knows
                        the student already paid — don't use "Cancel" in this case
                        (the student paid!). Use "تفعيل يدوي" only if the webhook
                        didn't fire automatically. */}
                    {(() => {
                      const paymentInitiated = !!o.provider_order_ref && /^\d+$/.test(o.provider_order_ref);
                      return (
                        <>
                          <Badge variant="secondary" className="text-xs">قيد الدفع</Badge>
                          {paymentInitiated && (
                            <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15">
                              تم الدفع على Paymob
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            disabled={actioningOrderId === o.id}
                            onClick={() => activateOrder(o.id)}
                            title={paymentInitiated
                              ? 'الطالب دفع على Paymob — اضغط هنا لتفعيل الاشتراك يدويًا (الـ webhook لم يصل)'
                              : 'تفعيل يدوي (تم استلام المبلغ خارج النظام)'}
                          >
                            {actioningOrderId === o.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <BadgeCheck className="h-3.5 w-3.5" />
                            )}
                            تفعيل يدوي
                          </Button>
                          {!paymentInitiated && (
                            // Only show "Cancel" if the student did NOT pay yet
                            // (if payment was initiated on Paymob, cancelling would
                            // be wrong — the student already paid)
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-50"
                              disabled={actioningOrderId === o.id}
                              onClick={() => cancelOrder(o.id)}
                              title="إلغاء الطلب المعلّق"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              إلغاء
                            </Button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
