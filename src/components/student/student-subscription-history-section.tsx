'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, History, RefreshCw, Search, BookOpen, Filter, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type { UserProfile } from '@/lib/types';

interface OrderHistory {
  id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  checkout_session_id: string | null;
  created_at: string;
  paid_at: string | null;
  activated_at: string | null;
  subject: { id: string; name: string; price: number } | null;
}

interface StudentSubscriptionHistorySectionProps {
  profile: UserProfile;
}

/**
 * Student's Subscription History section.
 *
 * Shows ALL the student's orders (pending, paid, cancelled, failed,
 * refunded) with full details. Each order has a unique payment code
 * (e.g., "SUB-73998EA0") that the student can copy and share with
 * support/teacher for fast lookup.
 *
 * Includes a search box to filter by payment code OR subject name.
 *
 * This is the student's "all my subscriptions" view — unlike the
 * "Pending Subscriptions" section which only shows pending ones.
 */
export default function StudentSubscriptionHistorySection({ profile }: StudentSubscriptionHistorySectionProps) {
  const { t } = useTranslations();
  const [orders, setOrders] = useState<OrderHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid' | 'cancelled' | 'failed'>('all');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');

      // Step 1: Fetch orders WITHOUT subject JOIN (RLS on subjects table
      // might block the JOIN for students with pending orders but no
      // enrollment yet). Fetch subject data SEPARATELY in step 2.
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id, subject_id, amount, currency, status,
          provider_order_ref, checkout_session_id,
          created_at, paid_at, activated_at
        `)
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (ordersError) {
        console.error('[sub-history] fetch error:', ordersError);
        toast.error('تعذّر جلب سجل الاشتراكات');
        return;
      }

      if (!ordersData || ordersData.length === 0) {
        setOrders([]);
        return;
      }

      // Step 2: Fetch subject data SEPARATELY using the subject_ids
      // from orders (avoids RLS issues with nested JOIN)
      const subjectIds = [...new Set(ordersData.map((o) => o.subject_id))];
      const { data: subjectsData } = await supabase
        .from('subjects')
        .select('id, name, price')
        .in('id', subjectIds);

      // Build subject lookup map
      const subjectMap = new Map<string, { id: string; name: string; price: number }>();
      if (subjectsData) {
        for (const s of subjectsData as Array<{ id: string; name: string; price: number }>) {
          subjectMap.set(s.id, s);
        }
      }

      // Merge: attach subject to each order
      const mergedOrders = ordersData.map((o) => ({
        ...o,
        subject: subjectMap.get(o.subject_id) ?? null,
      }));

      setOrders(mergedOrders as unknown as OrderHistory[]);
    } catch (err) {
      console.error('[sub-history] fetch failed:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Filter orders based on search + status
  const filteredOrders = orders.filter((o) => {
    // Status filter
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    // v113: search by payment_order_id (provider_order_ref) or subject name
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const orderRef = (o.provider_order_ref ?? '').toLowerCase();
      const orderId = (o.id ?? '').toLowerCase().slice(0, 8);
      const subjectName = (o.subject?.name ?? '').toLowerCase();
      if (!orderRef.includes(q) && !orderId.includes(q) && !subjectName.includes(q)) return false;
    }
    return true;
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`تم نسخ الكود: ${code}`);
    } catch {
      toast.error('تعذّر نسخ الكود');
    }
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case 'paid': return 'default';
      case 'pending': return 'secondary';
      case 'cancelled': return 'destructive';
      case 'failed': return 'destructive';
      case 'refunded': return 'outline';
      default: return 'secondary';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'مدفوع';
      case 'pending': return 'معلّق';
      case 'cancelled': return 'ملغي';
      case 'failed': return 'فشل';
      case 'refunded': return 'مسترجع';
      default: return status;
    }
  };

  return (
    <div className="space-y-4 p-3 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-start gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center shadow-lg shrink-0">
          <History className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">سجل الاشتراكات</h1>
          <p className="text-sm text-muted-foreground">
            كل عمليات الاشتراك اللي عملتها — لكل عملية كود مميز تقدر تستخدمه للبحث والمتابعة.
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

      {/* Search + filter */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالكود (SUB-XXXX) أو اسم المقرر..."
                className="ps-8"
              />
            </div>
            <div className="flex items-center gap-1">
              <Filter className="h-4 w-4 text-muted-foreground" />
              {(['all', 'pending', 'paid', 'cancelled', 'failed'] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? 'default' : 'outline'}
                  className="h-8 px-2 text-xs"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'all' ? 'الكل' : statusLabel(s)}
                </Button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            عدد النتائج: {filteredOrders.length} من {orders.length}
          </div>
        </CardContent>
      </Card>

      {/* Orders list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">العمليات</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="h-12 w-12 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                {orders.length === 0
                  ? 'لا يوجد عمليات اشتراك في سجلك حتى الآن.'
                  : 'لا توجد نتائج تطابق بحثك.'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredOrders.map((o) => {
                const INTERNAL_PREFIXES = ['order_', 'free_', 'manual_', 'force_', 'backfill_', 'verify_', 'gateway_', 'pi_test_', 'pi_live_'];
                const rawRef = o.provider_order_ref;
                const displayOrderId = rawRef && !INTERNAL_PREFIXES.some(p => rawRef.startsWith(p))
                  ? rawRef
                  : (o.id.length >= 8 ? o.id.slice(0, 8).toUpperCase() : o.id);
                const subjectPrice = Number(o.subject?.price ?? 0);
                const totalPaid = Number(o.amount ?? 0);
                return (
                  <div
                    key={o.id}
                    className="px-4 py-3 hover:bg-muted/30"
                  >
                    {/* v113: Redesigned transaction details card —
                        clean grid layout showing all key info. */}
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">
                          {o.subject?.name ?? 'مقرر غير معروف'}
                        </span>
                      </div>
                      <Badge variant={statusBadgeVariant(o.status)} className="text-xs">
                        {statusLabel(o.status)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      {/* Date + Time */}
                      <div>
                        <span className="text-muted-foreground">التاريخ</span>
                        <p className="font-medium" dir="ltr">
                          {new Date(o.created_at).toLocaleDateString('ar-EG')}
                          {' '}
                          <span className="text-muted-foreground">
                            {new Date(o.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        </p>
                      </div>
                      {/* Payment gateway + Order ID */}
                      <div>
                        <span className="text-muted-foreground">بوابة الدفع</span>
                        <p className="font-medium">Paymob</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">رقم العملية</span>
                        <button
                          type="button"
                          onClick={() => copyCode(displayOrderId)}
                          className="font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1"
                          title="اضغط للنسخ"
                        >
                          {displayOrderId}
                          <Copy className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      {/* Subject base price */}
                      <div>
                        <span className="text-muted-foreground">ثمن المقرر</span>
                        <p className="font-medium font-mono">{subjectPrice.toFixed(2)} {o.currency}</p>
                      </div>
                      {/* Total paid */}
                      <div>
                        <span className="text-muted-foreground">إجمالي المدفوع</span>
                        <p className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {totalPaid.toFixed(2)} {o.currency}
                        </p>
                      </div>
                      {o.checkout_session_id && (
                        <div>
                          <span className="text-muted-foreground">نوع الدفعة</span>
                          <p className="font-medium">دفعة موحدة</p>
                        </div>
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
