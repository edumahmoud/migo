'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Calendar, Download, DollarSign, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface BreakdownRow {
  period: string;
  gross_amount: number;
  platform_share: number;
  teacher_share: number;
  net_platform: number;
  transaction_count: number;
  unique_students: number;
  unique_subjects: number;
}

interface Summary {
  total_gross: number;
  total_platform: number;
  total_teacher: number;
  total_count: number;
  total_unique_students: number;
  total_unique_subjects: number;
}

type Period = 'day' | 'month' | 'year';

/**
 * Financial Breakdown Section — time-based grouping (day/month/year)
 * + Excel export.
 *
 * Shows:
 *   - Period selector (يوم / شهر / سنة)
 *   - Summary cards (total gross, platform share, teacher share, count)
 *   - Breakdown table (one row per period)
 *   - Export to Excel button (exports the breakdown table)
 */
export default function AdminFinancialBreakdownSection() {
  const { t, direction } = useTranslations();
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_gross: 0, total_platform: 0, total_teacher: 0, total_count: 0, total_unique_students: 0, total_unique_subjects: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (from) params.set('from', new Date(from).toISOString());
      if (to) {
        // Include the entire calendar day — set to end of day in UTC
        const endOfDay = new Date(to);
        endOfDay.setUTCHours(23, 59, 59, 999);
        params.set('to', endOfDay.toISOString());
      }
      const res = await fetch(`/api/admin/financial-ledger/breakdown?${params}`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setBreakdown(json.breakdown ?? []);
        setSummary(json.summary ?? { total_gross: 0, total_platform: 0, total_teacher: 0, total_count: 0, total_unique_students: 0, total_unique_subjects: 0 });
      } else {
        toast.error(json.error || 'تعذّر جلب البيانات');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [period, from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = async () => {
    if (breakdown.length === 0) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const headers = [
        ['الفترة', 'الإجمالي', 'حصة المنصة', 'حصة المعلم', 'طلاب فريدون', 'مقررات مباعة', 'عدد العمليات'],
      ];
      const rows = breakdown.map(r => [
        r.period,
        r.gross_amount,
        r.platform_share,
        r.teacher_share,
        r.unique_students ?? 0,
        r.unique_subjects ?? 0,
        r.transaction_count,
      ]);
      // Add summary row at the end
      rows.push([
        'الإجمالي',
        summary.total_gross,
        summary.total_platform,
        summary.total_teacher,
        summary.total_unique_students ?? 0,
        summary.total_unique_subjects ?? 0,
        summary.total_count,
      ]);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([...headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, `التقسيم (${period})`);
      const fileName = `financial_breakdown_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`تم تصدير ${breakdown.length} صف إلى ${fileName}`);
    } catch (err) {
      console.error('[export] failed', err);
      toast.error('تعذّر تصدير Excel');
    } finally {
      setExporting(false);
    }
  };

  const periodLabel = (p: string): string => {
    if (period === 'year') return p;
    if (period === 'month') {
      const [y, m] = p.split('-');
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      return `${monthNames[parseInt(m) - 1] ?? m} ${y}`;
    }
    // day
    return new Date(p).toLocaleDateString('ar-EG');
  };

  return (
    <div className="space-y-4" dir={direction}>
      {/* Header + period selector + date range filter */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-sky-600" />
          التقسيم الزمني للحسابات
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {(['day', 'month', 'year'] as Period[]).map(p => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? 'default' : 'outline'}
                className="h-8 text-xs"
                onClick={() => setPeriod(p)}
              >
                {p === 'day' ? 'يومي' : p === 'month' ? 'شهري' : 'سنوي'}
              </Button>
            ))}
          </div>
          {/* Date range filter (G4) */}
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-[140px] text-xs"
              aria-label="من تاريخ"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[140px] text-xs"
              aria-label="إلى تاريخ"
            />
            {(from || to) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => { setFrom(''); setTo(''); }}
                title="مسح الفلتر"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            onClick={handleExport}
            disabled={exporting || breakdown.length === 0}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            تصدير Excel
          </Button>
        </div>
      </div>

      {/* Summary cards — 6 KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي المدفوع</div>
            <div className="text-lg font-bold font-mono">{summary.total_gross.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">حصة المنصة</div>
            <div className="text-lg font-bold font-mono text-sky-600">{summary.total_platform.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">حصة المعلمين</div>
            <div className="text-lg font-bold font-mono text-emerald-600">{summary.total_teacher.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">طلاب فريدون</div>
            <div className="text-lg font-bold text-indigo-600">{summary.total_unique_students ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">مقررات مباعة</div>
            <div className="text-lg font-bold text-amber-600">{summary.total_unique_subjects ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">عدد العمليات</div>
            <div className="text-lg font-bold">{summary.total_count}</div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">تفصيل حسب {period === 'day' ? 'اليوم' : period === 'month' ? 'الشهر' : 'السنة'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : breakdown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <DollarSign className="h-12 w-12 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد بيانات مالية في هذه الفترة.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-start font-medium">الفترة</th>
                    <th className="p-3 text-end font-medium">الإجمالي</th>
                    <th className="p-3 text-end font-medium text-sky-600">المنصة</th>
                    <th className="p-3 text-end font-medium text-emerald-600">المعلمين</th>
                    <th className="p-3 text-center font-medium text-indigo-600">طلاب</th>
                    <th className="p-3 text-center font-medium text-amber-600">مقررات</th>
                    <th className="p-3 text-center font-medium">العمليات</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      <td className="p-3 text-start font-medium">{periodLabel(row.period)}</td>
                      <td className="p-3 text-end font-mono font-bold">{row.gross_amount.toFixed(2)}</td>
                      <td className="p-3 text-end font-mono text-sky-600">{row.platform_share.toFixed(2)}</td>
                      <td className="p-3 text-end font-mono text-emerald-600">{row.teacher_share.toFixed(2)}</td>
                      <td className="p-3 text-center text-indigo-600 font-medium">{row.unique_students ?? 0}</td>
                      <td className="p-3 text-center text-amber-600 font-medium">{row.unique_subjects ?? 0}</td>
                      <td className="p-3 text-center">
                        <Badge variant="secondary" className="text-xs">{row.transaction_count}</Badge>
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="border-t-2 border-sky-200 bg-sky-50/30 dark:bg-sky-900/10">
                    <td className="p-3 text-start font-bold">الإجمالي</td>
                    <td className="p-3 text-end font-mono font-bold">{summary.total_gross.toFixed(2)}</td>
                    <td className="p-3 text-end font-mono font-bold text-sky-600">{summary.total_platform.toFixed(2)}</td>
                    <td className="p-3 text-end font-mono font-bold text-emerald-600">{summary.total_teacher.toFixed(2)}</td>
                    <td className="p-3 text-center font-bold text-indigo-600">{summary.total_unique_students ?? 0}</td>
                    <td className="p-3 text-center font-bold text-amber-600">{summary.total_unique_subjects ?? 0}</td>
                    <td className="p-3 text-center font-bold">{summary.total_count}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
