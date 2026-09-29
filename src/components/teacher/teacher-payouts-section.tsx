'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wallet, Loader2, AlertCircle, RefreshCw, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  processing: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
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
  id: string; payout_method_type: string; payout_method_display_label: string;
  payout_method_masked: string; amount: string; currency: string; status: string;
  internal_reference: string; provider_reference: string | null;
  failure_reason: string | null; initiated_at: string; executed_at: string | null;
  created_at: string; updated_at: string; ledger_entry_count: number;
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

  if (loading && payouts.length === 0) return <div className="flex flex-col items-center py-20 gap-3" dir={direction}><Loader2 className="h-8 w-8 animate-spin text-sky-500" /><p className="text-sm text-muted-foreground">{t('financial.loading')}</p></div>;
  if (error && payouts.length === 0) return <div className="flex flex-col items-center py-20 gap-4" dir={direction}><AlertCircle className="h-6 w-6 text-red-600" /><Button onClick={fetchPayouts} variant="outline" size="sm"><RefreshCw className="h-4 w-4 me-2" />{t('common.retry')}</Button></div>;

  return (
    <div className="space-y-6" dir={direction}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6 text-emerald-600" />سجل المدفوعات</h1>
        <p className="text-sm text-muted-foreground mt-1">سجل معاملات المدفوعات الخاصة بك</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">قائمة المدفوعات</CardTitle>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-8"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {['pending','processing','completed','failed','cancelled'].map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s] ?? s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3"><Inbox className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">لا توجد مدفوعات بعد</p></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>التاريخ</TableHead><TableHead>المرجع</TableHead>
                    <TableHead>الوسيلة</TableHead><TableHead className="text-end">المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString('ar-EG')}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-sky-700 dark:text-sky-300">
                            {p.provider_reference || p.internal_reference}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{p.payout_method_type} — {p.payout_method_masked}</TableCell>
                        <TableCell className="text-end font-semibold">{Number(p.amount).toFixed(2)} {p.currency}</TableCell>
                        <TableCell><Badge variant="secondary" className={STATUS_COLOR[p.status] ?? ''}>{STATUS_LABELS[p.status] ?? p.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between p-3 border-t">
                <Button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} variant="outline" size="sm" className="h-8">{isRTL ? <ChevronRight /> : <ChevronLeft />}<span className="hidden sm:inline ms-1">{t('common.previous')}</span></Button>
                <span className="text-xs text-muted-foreground">{t('common.page')} {page} {t('common.of')} {Math.max(1, totalPages)}</span>
                <Button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} variant="outline" size="sm" className="h-8"><span className="hidden sm:inline me-1">{t('common.next')}</span>{isRTL ? <ChevronLeft /> : <ChevronRight />}</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
