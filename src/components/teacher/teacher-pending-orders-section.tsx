'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Ban, BadgeCheck, Clock, RefreshCw, Inbox, User, BookOpen, Copy, Search, CheckCircle2, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import type { UserProfile } from '@/lib/types';

interface PendingOrder {
  id: string;
  student_id: string;
  subject_id: string;
  amount: number;
  base_amount?: number | null;
  fees_total?: number | null;
  grand_total?: number | null;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  checkout_session_id: string | null;
  created_at: string;
  // v126: add plan_duration_days for free plan duration display
  plan_duration_days?: number | null;
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
  // v112: inline search by op code (SUB-XXXXXXXX format OR bare 8-char code
  // OR student name OR subject name). Filters the already-loaded list.
  const [searchQuery, setSearchQuery] = useState('');
  const { confirmDialog, confirm } = useConfirmDialog();

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
    const ok = await confirm({
      title: 'تأكيد التفعيل اليدوي',
      description: 'تأكيد: تم استلام المبلغ من الطالب خارج النظام؟ سيتم تفعيل الاشتراك يدويًا.',
      confirmLabel: 'تفعيل',
      cancelLabel: 'تراجع',
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: 'تأكيد الإلغاء',
      description: 'تأكيد: إلغاء هذا الطلب المعلّق؟ يمكن للطالب إنشاء طلب جديد بعد ذلك.',
      confirmLabel: 'إلغاء الطلب',
      cancelLabel: 'تراجع',
      variant: 'destructive',
    });
    if (!ok) return;
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

  // v113: client-side filter — search by payment_order_id (provider_order_ref),
  // student name, student email, student_code, subject name, OR provider reference.
  // Replaces the old SUB-XXXXXXXX format search.
  const filteredOrders = useMemo<PendingOrder[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const orderRef = (o.provider_order_ref ?? '').toLowerCase();
      const orderId = (o.id ?? '').toLowerCase();
      const studentName = (o.student?.name ?? '').toLowerCase();
      const studentEmail = (o.student?.email ?? '').toLowerCase();
      const studentCode = (o.student?.student_code ?? '').toLowerCase();
      const subjectName = (o.subject?.name ?? '').toLowerCase();
      return (
        orderRef.includes(q) ||
        orderId.startsWith(q) ||
        studentName.includes(q) ||
        studentEmail.includes(q) ||
        studentCode.includes(q) ||
        subjectName.includes(q)
      );
    });
  }, [orders, searchQuery]);

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

      {/* v113: removed PaymentCodeSearchBox (SUB-XXXXXXXX search) —
          unified search is now inline in the orders list header below. */}

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
          {/* v112: header with title + total count badge + inline search */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                الطلبات
                <Badge
                  variant="secondary"
                  className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  {filteredOrders.length} / {orders.length}
                </Badge>
              </CardTitle>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSearchQuery('')}
                >
                  مسح البحث
                </Button>
              )}
            </div>
            {/* v113: unified inline search field — searches by payment_order_id,
                student name/email/code, subject name. Replaces the old
                SUB-XXXXXXXX format search. */}
            <div className="relative max-w-md">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث برقم العملية أو اسم الطالب أو المقرر..."
                className="h-9 ps-8"
                aria-label="بحث"
              />
            </div>
          </div>
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
          ) : filteredOrders.length === 0 ? (
            /* v112: empty-state when search filters out everything */
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Search className="h-6 w-6 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">لا توجد طلبات مطابقة للبحث</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSearchQuery('')}
              >
                مسح البحث
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {filteredOrders.map((o) => (
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
                      {/* v113: payment_order_id display — replaces old SUB-XXXXXXXX code.
                          Shows the real Paymob Order ID (from provider_order_ref)
                          when available. Falls back to UUID-short when not. */}
                      {(() => {
                        const INTERNAL_PREFIXES = ['order_', 'free_', 'manual_', 'force_', 'backfill_', 'verify_', 'gateway_', 'pi_test_', 'pi_live_'];
                        const raw = o.provider_order_ref;
                        const displayCode = raw && !INTERNAL_PREFIXES.some(p => raw.startsWith(p))
                          ? raw
                          : (o.id.length >= 8 ? o.id.slice(0, 8).toUpperCase() : o.id);
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                navigator.clipboard?.writeText(displayCode);
                                toast.success(`تم نسخ رقم العملية: ${displayCode}`);
                              } catch { toast.error('تعذّر النسخ'); }
                            }}
                            className="text-xs font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1 self-start"
                            title="اضغط للنسخ"
                          >
                            <span className="font-bold">رقم العملية:</span>
                            <span className="bg-sky-50 dark:bg-sky-900/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                              {displayCode}
                              <Copy className="h-2.5 w-2.5" />
                            </span>
                          </button>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Right: amount + payment status + actions */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {/* v123/v126: show base + fees = total (when available) */}
                    {(() => {
                      const isFree = !o.amount || o.amount === 0;
                      if (isFree) {
                        // v126: show "مجاني" + plan duration
                        const durationDays = o.plan_duration_days ?? 30;
                        const durationLabel = durationDays >= 365 ? 'سنوي' :
                          durationDays >= 120 ? 'ترم' :
                          durationDays >= 60 ? 'فصلين' :
                          'شهري';
                        return (
                          <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
                            <Gift className="h-3 w-3 me-1" />
                            مجاني ({durationLabel})
                          </Badge>
                        );
                      }
                      const base = o.base_amount != null ? Number(o.base_amount) : null;
                      const fees = o.fees_total != null ? Number(o.fees_total) : null;
                      if (base !== null && fees !== null && fees > 0) {
                        return (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[9px] text-muted-foreground font-mono">
                              أصل: {base.toFixed(2)} + رسوم: {fees.toFixed(2)}
                            </span>
                            <span className="text-sm font-mono font-semibold">
                              {Number(o.amount).toFixed(2)} {o.currency}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <span className="text-sm font-mono font-semibold">
                          {Number(o.amount).toFixed(2)} {o.currency}
                        </span>
                      );
                    })()}
                    {/* v123: payment status badge with session awareness */}
                    {(() => {
                      const isFree = !o.amount || o.amount === 0;
                      if (isFree) return null;
                      // v123: check if THIS order has a real Paymob ref
                      const hasOwnRef = !!o.provider_order_ref &&
                        o.provider_order_ref.length > 5 &&
                        !o.provider_order_ref.startsWith('order_') &&
                        !o.provider_order_ref.startsWith('free_');
                      // v123: check if this order is part of a session where
                      // another order (the first one) has a Paymob ref
                      const hasSessionRef = !!o.checkout_session_id && orders.some(other =>
                        other.checkout_session_id === o.checkout_session_id &&
                        other.id !== o.id &&
                        !!other.provider_order_ref &&
                        other.provider_order_ref.length > 5 &&
                        !other.provider_order_ref.startsWith('order_') &&
                        !other.provider_order_ref.startsWith('free_')
                      );
                      const paymentInitiated = hasOwnRef || hasSessionRef;
                      if (paymentInitiated) {
                        const sessionOrder = orders.find(other =>
                          other.checkout_session_id === o.checkout_session_id &&
                          other.id !== o.id &&
                          !!other.provider_order_ref &&
                          other.provider_order_ref.length > 5 &&
                          !other.provider_order_ref.startsWith('order_') &&
                          !other.provider_order_ref.startsWith('free_')
                        );
                        const ref = hasOwnRef ? o.provider_order_ref! : (sessionOrder?.provider_order_ref ?? '—');
                        const refLabel = hasOwnRef ? 'رقم العملية' : 'رقم العملية (جلسة)';
                        const timestamp = new Date(o.created_at).toLocaleString('ar-EG', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        });
                        return (
                          <div className="flex flex-col items-end gap-0.5">
                            <Badge variant="outline" className="text-[9px] border-emerald-400 text-emerald-700 bg-emerald-50">
                              <CheckCircle2 className="h-2.5 w-2.5 me-0.5" />
                              تم الدفع
                            </Badge>
                            <span className="text-[9px] text-muted-foreground font-mono" dir="ltr" title={ref || ''}>
                              {refLabel}: {ref && ref.length > 18 ? ref.slice(0, 18) + '…' : ref}
                            </span>
                            <span className="text-[9px] text-muted-foreground">{timestamp}</span>
                          </div>
                        );
                      }
                      return (
                        <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-700 bg-amber-50">
                          <Clock className="h-2.5 w-2.5 me-0.5" />
                          بانتظار الدفع
                        </Badge>
                      );
                    })()}
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        disabled={actioningOrderId === o.id}
                        onClick={() => activateOrder(o.id)}
                        title="تفعيل يدوي (تم استلام المبلغ خارج النظام)"
                      >
                        {actioningOrderId === o.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <BadgeCheck className="h-3.5 w-3.5" />
                        )}
                        تفعيل يدوي
                      </Button>
                      {(() => {
                        const pi = !!o.provider_order_ref && o.provider_order_ref.length > 5 && !o.provider_order_ref.startsWith('order_') && !o.provider_order_ref.startsWith('free_');
                        return !pi ? (
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
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
