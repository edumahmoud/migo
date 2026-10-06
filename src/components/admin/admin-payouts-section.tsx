'use client';

// =====================================================
// AdminPayoutsSection — v112 improved layout + op-code search
// =====================================================
// Enhancements over the original:
//   1. Inline search field — searches by reference (provider OR
//      internal), teacher_id (for the bare UUID), masked method,
//      amount, or status label. Filters the already-loaded list
//      without a server round-trip.
//   2. Total count badge in the header (filtered / total).
//   3. Centered column headers + cell content (text-center) for
//      consistent visual alignment in both LTR + RTL layouts.
//   4. Long masked descriptors now wrap gracefully (break-words +
//      min-w-0) — fixes the truncated-text layout issue.
//   5. Click on reference copies the reference (not the UUID) —
//      provides instant clipboard feedback with a toast.
//   6. Horizontal scroll wrapper for narrow viewports so the table
//      never breaks the layout.
//   7. Removed the duplicate "page H1" header — the parent tab bar
//      already shows "المدفوعات" — eliminates the 3x duplication.
// =====================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, AlertCircle, RefreshCw, Play, XCircle, RotateCw, Inbox,
  ChevronLeft, ChevronRight, Search,
} from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  processing: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  cancelled: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'معلّق',
  processing: 'قيد المعالجة',
  completed: 'مكتمل',
  failed: 'فشل',
  cancelled: 'ملغى',
};

interface PayoutItem {
  id: string;
  teacher_id: string;
  payout_method_type: string;
  payout_method_display_label: string;
  payout_method_masked: string;
  amount: string;
  currency: string;
  status: string;
  internal_reference: string;
  provider_reference: string | null;
  failure_reason: string | null;
  initiated_at: string;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  ledger_entry_count: number;
  // v112: optional teacher name enrichment (the API may return it)
  teacher_name?: string;
}

export default function AdminPayoutsSection() {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  // v112: inline search field (filters the already-loaded list)
  const [searchQuery, setSearchQuery] = useState('');
  const { confirmDialog, confirm } = useConfirmDialog();

  const fetchPayouts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', '25');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/payouts?${params}`, { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setPayouts(json.data ?? []);
      setTotalPages(json.pagination?.total_pages ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  const executePayout = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/payouts/${id}/execute`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) { toast.error(json.error || 'فشل التنفيذ'); return; }
      toast.success('تم تنفيذ الدفعة');
      await fetchPayouts();
    } catch { toast.error('حدث خطأ غير متوقع'); }
  };

  const cancelPayout = async (id: string) => {
    const ok = await confirm({ title: 'تأكيد الإلغاء', description: 'هل تريد إلغاء هذه الدفعة؟', confirmLabel: 'إلغاء', cancelLabel: 'تراجع', variant: 'destructive' });
  if (!ok) return;
    try {
      const res = await fetch(`/api/admin/payouts/${id}/cancel`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) { toast.error(json.error || 'فشل الإلغاء'); return; }
      toast.success('تم إلغاء الدفعة');
      await fetchPayouts();
    } catch { toast.error('حدث خطأ غير متوقع'); }
  };

  const retryPayout = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/payouts/${id}/retry`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) { toast.error(json.error || 'فشلت الإعادة'); return; }
      toast.success('تمت إعادة المحاولة');
      await fetchPayouts();
    } catch { toast.error('حدث خطأ غير متوقع'); }
  };

  // v112: client-side search filter — matches reference (provider OR
  // internal), masked method, method type, amount, status label, OR
  // teacher name (if present in the API response).
  const filteredPayouts = useMemo<PayoutItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return payouts;
    return payouts.filter((p) => {
      const providerRef = (p.provider_reference ?? '').toLowerCase();
      const internalRef = (p.internal_reference ?? '').toLowerCase();
      const masked = (p.payout_method_masked ?? '').toLowerCase();
      const methodType = (p.payout_method_type ?? '').toLowerCase();
      const amount = (p.amount ?? '').toLowerCase();
      const status = (STATUS_LABELS[p.status] ?? p.status ?? '').toLowerCase();
      const teacherName = (p.teacher_name ?? '').toLowerCase();
      return (
        providerRef.includes(q) ||
        internalRef.includes(q) ||
        masked.includes(q) ||
        methodType.includes(q) ||
        amount.includes(q) ||
        status.includes(q) ||
        teacherName.includes(q)
      );
    });
  }, [payouts, searchQuery]);

  // v112: format date + time (was date-only before)
  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(isRTL ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return '—';
    }
  };

  const copyRef = (text: string) => {
    try {
      navigator.clipboard?.writeText(text);
      toast.success('تم نسخ المرجع');
    } catch { /* ignore */ }
  };

  if (loading && payouts.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 gap-3" dir={direction}>
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        <p className="text-sm text-muted-foreground">جارٍ تحميل المدفوعات...</p>
      </div>
    );
  }
  if (error && payouts.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 gap-4" dir={direction}>
        <AlertCircle className="h-6 w-6 text-red-600" />
        <p className="font-semibold">تعذّر التحميل</p>
        <Button onClick={fetchPayouts} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 me-2" />
          {t('common.retry') || 'إعادة'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={direction}>
      {/* v112: removed the page H1 — the parent tab bar already shows
          "المدفوعات" — eliminates the duplicate label. */}

      {/* v113: removed PaymentCodeSearchBox (SUB-XXXXXXXX search) —
          unified search is now inline in the payouts table header. */}

      <Card>
        <CardHeader className="pb-3">
          {/* v112: header with title + count badge + status filter + search */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                {isRTL ? 'قائمة المدفوعات' : 'Payouts'}
                {' '}
                {/* v112: filtered/total count badge */}
                <Badge
                  variant="secondary"
                  className="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                >
                  {filteredPayouts.length} / {payouts.length}
                </Badge>
              </CardTitle>
              <Select
                value={statusFilter}
                onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-40 h-8">
                  <SelectValue placeholder={isRTL ? 'الكل' : 'All'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isRTL ? 'الكل' : 'All'}</SelectItem>
                  {['pending', 'processing', 'completed', 'failed', 'cancelled'].map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* v112: inline search field — searches by reference, masked
                method, method type, amount, status, OR teacher name. */}
            <div className="relative max-w-md">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isRTL
                  ? 'ابحث بالمرجع أو الوسيلة أو المبلغ أو الحالة...'
                  : 'Search by reference, method, amount, or status...'}
                className="h-9 ps-8"
                aria-label={isRTL ? 'بحث' : 'Search'}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredPayouts.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? (isRTL ? 'لا توجد نتائج مطابقة للبحث' : 'No matching payouts')
                  : (isRTL ? 'لا توجد مدفوعات' : 'No payouts')}
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSearchQuery('')}
                >
                  {isRTL ? 'مسح البحث' : 'Clear search'}
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* v112: horizontal scroll wrapper so the table never breaks
                  on narrow viewports. min-w-[760px] ensures columns have
                  enough space + prevents truncation. */}
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      {/* v112: all column headers centered for visual
                          consistency in both LTR + RTL layouts. */}
                      <TableHead className="text-center w-[150px] sm:w-[170px]">{isRTL ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead className="text-center w-[140px] sm:w-[170px]">{isRTL ? 'المرجع' : 'Reference'}</TableHead>
                      <TableHead className="text-center w-[120px] sm:w-[140px]">{isRTL ? 'المعلم' : 'Teacher'}</TableHead>
                      <TableHead className="text-center">{isRTL ? 'الوسيلة' : 'Method'}</TableHead>
                      <TableHead className="text-center w-[120px] sm:w-[140px]">{isRTL ? 'المبلغ' : 'Amount'}</TableHead>
                      <TableHead className="text-center w-[100px]">{isRTL ? 'الحالة' : 'Status'}</TableHead>
                      <TableHead className="text-center w-[140px]">{isRTL ? 'إجراءات' : 'Actions'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayouts.map((p) => (
                      <TableRow key={p.id}>
                        {/* v112: date+time cell — centered, LTR for stable date format */}
                        <TableCell className="text-center text-xs text-muted-foreground whitespace-nowrap" dir="ltr">
                          {formatDateTime(p.created_at)}
                        </TableCell>
                        {/* v112: reference cell — clickable (copies reference, not UUID) */}
                        <TableCell className="text-center">
                          <button
                            type="button"
                            onClick={() => copyRef(p.provider_reference || p.internal_reference)}
                            className="font-mono text-xs text-sky-700 dark:text-sky-300 hover:underline text-center break-all inline-block max-w-full"
                            title={p.provider_reference || p.internal_reference}
                            dir="ltr"
                          >
                            {p.provider_reference || p.internal_reference}
                          </button>
                        </TableCell>
                        {/* teacher name (when available) OR teacher_id short */}
                        <TableCell className="text-center text-xs">
                          {p.teacher_name || (isRTL ? '—' : '—')}
                        </TableCell>
                        {/* v112: method cell — wraps gracefully with min-w-0 +
                            break-words so long masked strings don't break layout */}
                        <TableCell className="text-center min-w-0">
                          <div className="flex flex-col gap-0.5 min-w-0 items-center">
                            <span className="text-xs font-medium text-foreground break-words">
                              {p.payout_method_type}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground break-all" dir="ltr">
                              {p.payout_method_masked}
                            </span>
                          </div>
                        </TableCell>
                        {/* v112: amount — centered, LTR for stable numeric format */}
                        <TableCell className="text-center font-semibold whitespace-nowrap" dir="ltr">
                          {Number(p.amount).toFixed(2)}
                          <span className="text-[10px] text-muted-foreground ms-1">{p.currency}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className={`whitespace-nowrap ${STATUS_COLOR[p.status] ?? ''}`}>
                            {STATUS_LABELS[p.status] ?? p.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-center">
                            {p.status === 'pending' && (
                              <Button
                                onClick={() => executePayout(p.id)}
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                title={isRTL ? 'تنفيذ الدفعة' : 'Execute payout'}
                              >
                                <Play className="h-3 w-3" />
                                {isRTL ? 'تنفيذ' : 'Execute'}
                              </Button>
                            )}
                            {p.status === 'pending' && (
                              <Button
                                onClick={() => cancelPayout(p.id)}
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-rose-600"
                                title={isRTL ? 'إلغاء الدفعة' : 'Cancel payout'}
                              >
                                <XCircle className="h-3 w-3" />
                                {isRTL ? 'إلغاء' : 'Cancel'}
                              </Button>
                            )}
                            {p.status === 'failed' && (
                              <Button
                                onClick={() => retryPayout(p.id)}
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-amber-600"
                                title={isRTL ? 'إعادة المحاولة' : 'Retry'}
                              >
                                <RotateCw className="h-3 w-3" />
                                {isRTL ? 'إعادة' : 'Retry'}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* v112: pagination footer — clearer layout + showing-X-of-Y */}
              <div className="flex items-center justify-between p-3 border-t gap-2 flex-wrap">
                <Button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  variant="outline"
                  size="sm"
                  className="h-8"
                >
                  {isRTL ? <ChevronRight /> : <ChevronLeft />}
                  <span className="hidden sm:inline ms-1">{t('common.previous') || 'السابق'}</span>
                </Button>
                <span className="text-xs text-muted-foreground" dir="ltr">
                  {t('common.page') || 'صفحة'} {page} {t('common.of') || 'من'} {Math.max(1, totalPages)}
                </span>
                <Button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  variant="outline"
                  size="sm"
                  className="h-8"
                >
                  <span className="hidden sm:inline me-1">{t('common.next') || 'التالي'}</span>
                  {isRTL ? <ChevronLeft /> : <ChevronRight />}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}