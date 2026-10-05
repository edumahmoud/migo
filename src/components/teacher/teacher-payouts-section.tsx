'use client';

// =====================================================
// TeacherPayoutsSection — v112 reorganized layout
// =====================================================
// Fixes the layout issues from the v111 version:
//   1. "الوصف" column had truncated text (long masked
//      descriptors like "4624 ---- ••• instapay • بر") that
//      didn't wrap, broke the row layout, and overlapped with
//      the "المبلغ" column.
//   2. Header duplication — the nav tab "سجل المدفوعات" + the
//      page H1 "سجل المدفوعات" + the card title "قائمة
//      المدفوعات" = 3 occurrences of the same label in <200px.
//   3. No alignment for amounts + dates (centered vs end-justified).
//
// v112 fixes:
//   - Removed the page-level H1 (the tab bar already provides context).
//   - Removed the inner CardTitle "قائمة المدفوعات" — replaced with
//     a status filter + total count badge.
//   - The "الوسيلة" column now wraps gracefully with `break-words`
//     + uses smaller font, and the masked portion is monospace.
//   - Added `min-w-0` to the wrapper so flex children can shrink.
//   - Amounts right-aligned (`text-end`) for visual scanning.
//   - Long table content gets horizontal scroll on small screens.
// =====================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, Loader2, AlertCircle, RefreshCw, Inbox,
  ChevronLeft, ChevronRight, Search,
} from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';

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
}

export default function TeacherPayoutsSection() {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  // v112: search field for the payouts list
  const [searchQuery, setSearchQuery] = useState('');

  const fetchPayouts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page)); params.set('page_size', '25');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/teacher/payouts?${params}`, { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setPayouts(json.data ?? []);
      setTotalPages(json.pagination?.total_pages ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  // v112: client-side search filter on the loaded payouts
  const filteredPayouts = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return payouts;
    return payouts.filter((p) => {
      const ref = (p.provider_reference || p.internal_reference || '').toLowerCase();
      const method = (p.payout_method_type || '').toLowerCase();
      const masked = (p.payout_method_masked || '').toLowerCase();
      const label = (p.payout_method_display_label || '').toLowerCase();
      const amount = (p.amount || '').toLowerCase();
      const status = (STATUS_LABELS[p.status] || p.status || '').toLowerCase();
      return (
        ref.includes(q) ||
        method.includes(q) ||
        masked.includes(q) ||
        label.includes(q) ||
        amount.includes(q) ||
        status.includes(q)
      );
    });
  })();

  // v112: format the date + time (was date-only before)
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

  // v112: copy reference to clipboard (clickable reference cell)
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
        <p className="text-sm text-muted-foreground">{t('financial.loading') || 'جاري التحميل...'}</p>
      </div>
    );
  }
  if (error && payouts.length === 0) {
    return (
      <div className="flex flex-col items-center py-20 gap-4" dir={direction}>
        <AlertCircle className="h-6 w-6 text-red-600" />
        <Button onClick={fetchPayouts} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 me-2" />
          {t('common.retry') || 'إعادة'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={direction}>
      {/* v112: removed the page H1 — the tab bar above ("سجل المدفوعات")
          already provides context. No header duplication. */}

      <Card>
        <CardHeader className="pb-3">
          {/* v112: header layout — status filter + search + total count badge */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-foreground">
                {t('financial.tabs.payouts') || 'سجل المدفوعات'}
                {' '}
                {/* v112: total count badge in the header */}
                <Badge
                  variant="secondary"
                  className="ms-2 bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                >
                  {filteredPayouts.length} {isRTL ? 'عملية' : 'payouts'}
                </Badge>
              </h2>
              <Select
                value={statusFilter}
                onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="w-40 h-8">
                  <SelectValue placeholder={t('financial.filters.allStatuses') || 'الكل'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('financial.filters.allStatuses') || 'الكل'}</SelectItem>
                  {['pending', 'processing', 'completed', 'failed', 'cancelled'].map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* v112: search field */}
            <div className="relative max-w-md">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isRTL
                  ? 'ابحث بالمرجع أو الوسيلة أو المبلغ...'
                  : 'Search by reference, method, or amount...'}
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
                  : (isRTL ? 'لا توجد مدفوعات بعد' : 'No payouts yet')}
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
              {/* v112: horizontal scroll wrapper for narrow screens
                  so the description column never breaks the layout */}
              <div className="overflow-x-auto">
                <Table className="min-w-[680px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px] sm:w-[170px]">{isRTL ? 'التاريخ' : 'Date'}</TableHead>
                      <TableHead className="w-[120px] sm:w-[160px]">{isRTL ? 'المرجع' : 'Reference'}</TableHead>
                      <TableHead>{isRTL ? 'الوسيلة' : 'Method'}</TableHead>
                      <TableHead className="text-end w-[110px] sm:w-[130px]">{isRTL ? 'المبلغ' : 'Amount'}</TableHead>
                      <TableHead className="w-[90px] sm:w-[100px]">{isRTL ? 'الحالة' : 'Status'}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayouts.map((p) => (
                      <TableRow key={p.id}>
                        {/* v112: date + time cell */}
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                          {formatDateTime(p.created_at)}
                        </TableCell>
                        <TableCell>
                          {/* v112: clickable reference (copies to clipboard) */}
                          <button
                            type="button"
                            onClick={() => copyRef(p.provider_reference || p.internal_reference)}
                            className="font-mono text-xs text-sky-700 dark:text-sky-300 hover:underline text-start break-all"
                            title={p.provider_reference || p.internal_reference}
                            dir="ltr"
                          >
                            {p.provider_reference || p.internal_reference}
                          </button>
                        </TableCell>
                        {/* v112: method cell — wraps gracefully with
                            min-w-0 + break-words so long masked strings
                            don't break the layout */}
                        <TableCell className="min-w-0">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-xs font-medium text-foreground break-words">
                              {p.payout_method_display_label || p.payout_method_type}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground break-all" dir="ltr">
                              {p.payout_method_masked}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-end font-semibold whitespace-nowrap" dir="ltr">
                          {Number(p.amount).toFixed(2)}
                          <span className="text-[10px] text-muted-foreground ms-1">{p.currency}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`whitespace-nowrap ${STATUS_COLOR[p.status] ?? ''}`}>
                            {STATUS_LABELS[p.status] ?? p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* v112: pagination footer — clearer alignment + showing-X-of-Y */}
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
    </div>
  );
}
