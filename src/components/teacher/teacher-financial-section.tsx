'use client';

// =====================================================
// TeacherFinancialSection — Phase 10
// =====================================================
// Displays the authenticated teacher's financial data sourced
// EXCLUSIVELY from `financial_ledger` (snapshotted values).
//
// Critical security property:
//   - teacher_id is taken from the server-side session by the API.
//   - The frontend CANNOT override teacher_id via query params, body, or headers.
//   - The frontend has NO mutate buttons (no edit/delete/create) — read-only UI.
//   - All amounts are rendered as received; never recomputed client-side.
//
// Historical integrity:
//   - Refunds/reversals/status changes do NOT change gross_amount, teacher_share,
//     or platform_share (the dashboard displays whatever the ledger snapshot has).
//   - The teacher changing commission rates, subject teacher, or gateway in the
//     future will not retroactively change rows in this view — they are snapshots.
// =====================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Banknote,
  Receipt,
  Loader2,
  AlertCircle,
  RefreshCw,
  Filter,
  X,
  Inbox,
  Users,
  Calculator,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FinancialCharts, ChartViewToggle, ChartView } from '@/components/shared/financial-charts';

// ─── Types matching API response shape ───
interface TransactionRow {
  id: string;
  order_id: string;
  subject_id: string;
  subject_name: string;
  student_name: string;
  currency: string;
  gross_amount: number;
  platform_share: number;
  teacher_share: number;
  gateway_fee: number;
  net_amount: number;
  commission_rate: number;
  status: 'paid' | 'refunded' | 'reversed' | 'settled' | 'pending' | 'failed';
  created_at: string;
  // Generic payment_order_id — sourced from orders.provider_order_ref.
  // For Paymob: the numeric Paymob Order ID. For future gateways:
  // that gateway's Order ID. NULL for free/unpaid orders. The UI
  // filters out internal placeholders before displaying.
  payment_order_id?: string | null;
}

interface Summary {
  total_gross: string;
  total_teacher_share: string;
  total_platform_share: string;
  total_gateway_fee: string;
  transaction_count: number;
  active_subscriptions: number;
  unique_students: number;
  avg_net_income: string;
  successful_count: number;
  avg_transaction_value: string;
  settled_count: number;
  paid_count: number;
  refunded_count: number;
  reversed_count: number;
  pending_count: number;
  failed_count: number;
  // v113: teacher's current per-teacher commission rate (null = global).
  // resolved_commission_rate = per-teacher rate OR global fallback.
  commission_rate?: number | null;
  resolved_commission_rate?: number;
}

interface SubjectFilter {
  subject_id: string;
  subject_name: string;
}

interface RevenueResponse {
  success: boolean;
  error?: string;
  summary?: Summary;
  transactions?: TransactionRow[];
  subjects?: SubjectFilter[];
  filters?: {
    date_from: string | null;
    date_to: string | null;
    subject_id: string | null;
    status: string | null;
  };
}

// ─── Status color map ───
// We intentionally do NOT invent new statuses — only the 6 the DB CHECK allows.
const STATUS_COLOR: Record<TransactionRow['status'], string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  settled: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  refunded: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  reversed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const STATUS_OPTIONS: TransactionRow['status'][] = [
  'paid',
  'refunded',
  'reversed',
  'settled',
  'pending',
  'failed',
];

// ─── Component ───
export default function TeacherFinancialSection() {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';

  // Filter state — never includes teacher_id (server-enforced)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Filter UI visibility (mobile)
  const [filtersOpen, setFiltersOpen] = useState(false);

  // v112: summary view toggle (cards / bar / line)
  const [summaryView, setSummaryView] = useState<ChartView>('cards');

  // v112: transactions log — search + sort + op code column
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [timeFilter, setTimeFilter] = useState('');  // HH:MM filter (matches any time-of-day)

  // Data state
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Fetch data ───
  // Re-fetches whenever any filter changes. The teacher_id is appended
  // implicitly by the server (from session) — never sent from client.
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (subjectFilter !== 'all') params.set('subject_id', subjectFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(
        `/api/teacher/revenue?${params.toString()}`,
        { headers: await getCachedAuthHeaders() }
      );
      const json = (await res.json()) as RevenueResponse;
      if (!json.success || !json.summary) {
        throw new Error(json.error || t('financial.errors.loadFailed'));
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('financial.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, subjectFilter, statusFilter, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Filter active state ───
  const hasActiveFilters = useMemo(
    () => Boolean(dateFrom || dateTo || subjectFilter !== 'all' || statusFilter !== 'all'),
    [dateFrom, dateTo, subjectFilter, statusFilter]
  );

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSubjectFilter('all');
    setStatusFilter('all');
  };

  // ─── Format helpers ───
  const formatAmount = (val: string | number, currency = 'EGP') => {
    const n = Number(val) || 0;
    // Format with 2 decimals and thousands separator.
    const formatted = n.toLocaleString(isRTL ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${formatted} ${t('financial.currency')}`;
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  // v112: format the timestamp with BOTH date + time
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

  // v112: format JUST the time (HH:MM)
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(isRTL ? 'ar-EG' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return '—';
    }
  };

  // v112: derive a short operation code from the transaction's UUID.
  // Uses the FIRST 8 chars of the UUID uppercased — short + unique enough
  // for visual identification. The full UUID is still in tx.id for DB lookups.
  const formatOpCode = (uuid: string) => {
    if (!uuid || uuid.length < 8) return uuid ?? '—';
    return uuid.slice(0, 8).toUpperCase();
  };

  // payment_order_id validation — returns the real gateway Order ID
  // when the value is NOT an internal placeholder.
  //
  // Internal placeholders (created by the system, NOT by the gateway):
  //   "order_<UUID>"    — initial state at checkout, before payment
  //   "free_<UUID>"     — free course
  //   "manual_<UUID>"   — manual activation by teacher
  //   "force_<UUID>"    — force-activation by admin
  //   "backfill_<id>"   — backfilled by admin
  //   "verify_<id>"     — verify-fallback path
  //   "gateway_<UUID>"  — fallback when gateway didn't return a reference
  //
  // Real gateway Order IDs (created by the gateway):
  //   Paymob: numeric like "625912253"
  //   Fawry (future): alphanumeric
  //   Any other gateway (future): that gateway's format
  //
  // Rule: if the value doesn't start with any known internal prefix,
  // it's a real gateway Order ID → display it.
  const INTERNAL_PREFIXES = [
    'order_', 'free_', 'manual_', 'force_', 'backfill_', 'verify_', 'gateway_',
    'pi_test_', 'pi_live_', // Paymob Intention IDs — not real Order IDs
  ];
  const resolvePaymentOrderId = (tx: TransactionRow): string => {
    const raw = tx.payment_order_id;
    if (!raw) return '—';
    if (INTERNAL_PREFIXES.some((p) => raw.startsWith(p))) return '—';
    return raw;
  };

  const summary = data?.summary;
  const transactions = data?.transactions ?? [];
  const subjectOptions = data?.subjects ?? [];

  // v112: client-side search + sort + time filter on the already-loaded
  // transactions. The server-side filters (date range, subject, status)
  // are still applied via the API. The client-side search is for fast
  // in-page filtering by op code / order / student name.
  const filteredAndSorted = useMemo<TransactionRow[]>(() => {
    let result: TransactionRow[] = transactions;
    // Search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((tx: TransactionRow) => {
        const opCode = formatOpCode(tx.id).toLowerCase();
        const orderId = (tx.order_id ?? '').toLowerCase();
        const student = (tx.student_name ?? '').toLowerCase();
        const subject = (tx.subject_name ?? '').toLowerCase();
        return (
          opCode.includes(q) ||
          orderId.includes(q) ||
          student.includes(q) ||
          subject.includes(q)
        );
      });
    }
    // Time-of-day filter (HH:MM substring match against tx.created_at's time)
    if (timeFilter) {
      const t = timeFilter.trim();
      result = result.filter((tx: TransactionRow) => {
        try {
          const d = new Date(tx.created_at);
          const hhmm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
          return hhmm.startsWith(t);
        } catch {
          return false;
        }
      });
    }
    // Sort by created_at (desc = newest first by default)
    result = [...result].sort((a: TransactionRow, b: TransactionRow) => {
      const aT = new Date(a.created_at).getTime() || 0;
      const bT = new Date(b.created_at).getTime() || 0;
      return sortDir === 'asc' ? aT - bT : bT - aT;
    });
    return result;
  }, [transactions, searchQuery, timeFilter, sortDir]);

  // ─── Loading state ───
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3" dir={direction}>
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        <p className="text-sm text-muted-foreground">{t('financial.loading')}</p>
      </div>
    );
  }

  // ─── Error state ───
  if (error && !data) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 gap-4 text-center"
        dir={direction}
      >
        <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-3">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <p className="font-semibold text-foreground">{t('financial.errors.loadFailed')}</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 me-2" />
          {t('financial.errors.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={direction}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          {t('financial.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('financial.subtitle')}</p>
      </div>

      {/* v110: Tabbed layout — Summary cards in "overview" tab, transactions in "transactions" tab */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="overview">{t('financial.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="transactions">{t('financial.tabs.transactions')}</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Overview (Summary Cards OR Charts) ─── */}
        <TabsContent value="overview" className="space-y-6">
      {/* v112: Summary view toggle (cards / bar / line) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Receipt className="h-3.5 w-3.5" />
          {t('financial.viewToggle.label') || 'طريقة العرض'}
        </div>
        <ChartViewToggle view={summaryView} onChange={setSummaryView} />
      </div>

      {/* v112: Conditional render — cards (default) or charts */}
      {summaryView === 'cards' && summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          <SummaryCard
            icon={<TrendingUp className="h-5 w-5" />}
            label={t('financial.summary.totalGross')}
            value={formatAmount(summary.total_gross)}
            color="bg-gradient-to-br from-sky-500 to-sky-700 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<DollarSign className="h-5 w-5" />}
            label={t('financial.summary.teacherShare')}
            value={formatAmount(summary.total_teacher_share)}
            color="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Receipt className="h-5 w-5" />}
            label={t('financial.summary.transactions')}
            value={String(summary.transaction_count)}
            color="bg-gradient-to-br from-rose-400 to-rose-500 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Users className="h-5 w-5" />}
            label={t('financial.summary.activeSubscriptions')}
            value={String(summary.active_subscriptions)}
            color="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Users className="h-5 w-5" />}
            label={t('financial.summary.uniqueStudents')}
            value={String(summary.unique_students)}
            color="bg-gradient-to-br from-purple-500 to-purple-600 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Calculator className="h-5 w-5" />}
            label={t('financial.summary.avgStudentRevenue')}
            value={formatAmount(summary.avg_net_income)}
            color="bg-gradient-to-br from-teal-500 to-teal-600 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Calculator className="h-5 w-5" />}
            label={t('financial.summary.avgTransactionValue')}
            value={formatAmount(summary.avg_transaction_value)}
            color="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white"
            iconBg="bg-white/25"
          />
        </div>
      )}

      {/* v113: Commission rate card — shows the teacher's CURRENT
          commission rate (per-teacher override OR global fallback).
          No "عام" label — shows the resolved rate directly.
          Positioned right after the summary cards grid. */}
      {summary && (
        <div className="rounded-xl border-2 border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-violet-50/80 to-fuchsia-50/60 dark:from-violet-900/15 dark:to-fuchsia-900/10 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-violet-700/70 dark:text-violet-300/60">نسبة العمولة</p>
              <p className="text-2xl font-bold font-mono text-violet-900 dark:text-violet-100">
                {Number(summary.resolved_commission_rate ?? 0).toFixed(2)}%
              </p>
            </div>
            <div className="text-end shrink-0">
              <p className="text-[10px] text-muted-foreground">عمولة المنصة</p>
              <p className="text-[10px] text-muted-foreground">لكل معاملة جديدة</p>
            </div>
          </div>
        </div>
      )}

      {summaryView !== 'cards' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {summaryView === 'bar'
                ? (t('financial.viewToggle.barChart') || 'رسم الأعمدة')
                : (t('financial.viewToggle.lineChart') || 'رسم خطي')}
            </CardTitle>
            <CardDescription className="sr-only">
              {t('financial.subtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FinancialCharts
              view={summaryView}
              transactions={transactions}
              currency={t('financial.currency') || 'EGP'}
              height={320}
            />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">{t('financial.filters.title')}</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button onClick={clearFilters} variant="ghost" size="sm" className="h-8">
                <X className="h-3.5 w-3.5 me-1" />
                {t('financial.filters.clear')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('financial.filters.dateFrom')}
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('financial.filters.dateTo')}
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('financial.filters.subject')}
              </label>
              <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('financial.filters.allSubjects')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('financial.filters.allSubjects')}</SelectItem>
                  {subjectOptions.map((s) => (
                    <SelectItem key={s.subject_id} value={s.subject_id}>
                      {s.subject_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('financial.filters.status')}
              </label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('financial.filters.allStatuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('financial.filters.allStatuses')}</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`financial.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        {/* ─── Tab 2: Transactions (العمليات المسجلة) ─── */}
        <TabsContent value="transactions" className="space-y-6">
      {/* Transactions Table — v112: added op code column, search, time,
          sort, total count badge in header */}
      <Card>
        <CardHeader className="pb-3">
          {/* v112: search + total count + sort controls in the header */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">
                {t('financial.tabs.transactions')}
              </CardTitle>
              <CardDescription className="sr-only">{t('financial.subtitle')}</CardDescription>
            </div>
            {/* v112: Search field — searches op code / order / student / subject */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('financial.search.placeholder') || 'ابحث بكود العملية أو الطلب أو الطالب...'}
                  className="h-9 ps-8"
                  aria-label={t('financial.search.label') || 'بحث'}
                />
              </div>
              {/* v112: time-of-day filter (HH:MM) */}
              <Input
                type="time"
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="h-9 w-32"
                aria-label={t('financial.table.time') || 'الوقت'}
                title={t('financial.table.time') || 'الوقت'}
              />
              {/* v112: sort toggle (asc / desc) */}
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                title={sortDir === 'asc'
                  ? (t('financial.sort.asc') || 'تصاعدي')
                  : (t('financial.sort.desc') || 'تنازلي')}
              >
                {sortDir === 'asc'
                  ? <ArrowUp className="h-3.5 w-3.5" />
                  : <ArrowDown className="h-3.5 w-3.5" />}
                <ArrowUpDown className="h-3 w-3 opacity-50" />
                <span className="text-xs">
                  {sortDir === 'asc'
                    ? (t('financial.sort.asc') || 'تصاعدي')
                    : (t('financial.sort.desc') || 'تنازلي')}
                </span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
              <span className="text-sm text-muted-foreground">{t('financial.loading')}</span>
            </div>
          )}

          {!loading && transactions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="rounded-full bg-muted p-4">
                <Inbox className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                {t('financial.table.empty')}
              </p>
            </div>
          )}

          {/* v112: empty filtered results state — when there are transactions
              but the search/time filter excluded them all */}
          {!loading && transactions.length > 0 && filteredAndSorted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Search className="h-6 w-6 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">
                {t('financial.table.empty') || 'لا توجد نتائج مطابقة للبحث'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setSearchQuery(''); setTimeFilter(''); }}
              >
                مسح البحث
              </Button>
            </div>
          )}

          {!loading && filteredAndSorted.length > 0 && (
            <>
              {/* Desktop table (md+) */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* v112: op code column (NEW) */}
                      <TableHead>{t('financial.table.opCode') || 'كود العملية'}</TableHead>
                      {/* Generic payment_order_id column — sourced from
                          orders.provider_order_ref. Shows the gateway's
                          Order ID (Paymob, Fawry, etc.) next to the
                          student's operation code. */}
                      <TableHead>رقم الطلب</TableHead>
                      {/* v112: date column with time included */}
                      <TableHead>
                        <button
                          type="button"
                          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          title={sortDir === 'asc'
                            ? (t('financial.sort.desc') || 'تنازلي')
                            : (t('financial.sort.asc') || 'تصاعدي')}
                        >
                          {t('financial.table.date') || 'التاريخ'}
                          {sortDir === 'asc'
                            ? <ArrowUp className="h-3 w-3" />
                            : <ArrowDown className="h-3 w-3" />}
                        </button>
                      </TableHead>
                      <TableHead>{t('financial.table.student')}</TableHead>
                      <TableHead>{t('financial.table.course')}</TableHead>
                      <TableHead className="text-end">{t('financial.table.teacherShare')}</TableHead>
                      <TableHead>{t('financial.table.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSorted.map((tx) => (
                      <TableRow key={tx.id}>
                        {/* v112: op code cell — short, monospace, copyable.
                            Click copies the SHORT code (1DD8E6E5),
                            NOT the full UUID. The full UUID stays in
                            the title attribute for tooltip/hover. */}
                        <TableCell className="whitespace-nowrap">
                          <code
                            className="font-mono text-xs text-sky-700 dark:text-sky-300 cursor-pointer hover:underline"
                            title={tx.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              const shortCode = formatOpCode(tx.id);
                              try {
                                navigator.clipboard?.writeText(shortCode);
                                toast.success(`تم نسخ كود العملية: ${shortCode}`);
                              } catch { /* ignore — clipboard may not be available */ }
                            }}
                          >
                            {formatOpCode(tx.id)}
                          </code>
                        </TableCell>
                        {/* payment_order_id cell — shows the gateway's
                            Order ID (Paymob, Fawry, etc.) when available.
                            Internal placeholders (order_<UUID>, free_<UUID>,
                            etc.) are filtered out — "—" is shown instead. */}
                        <TableCell className="whitespace-nowrap text-xs font-mono">
                          {(() => {
                            const orderId = resolvePaymentOrderId(tx);
                            return orderId === '—'
                              ? <span className="text-muted-foreground">—</span>
                              : <span className="text-sky-700 dark:text-sky-300">{orderId}</span>;
                          })()}
                        </TableCell>
                        {/* v112: date+time cell (was date-only) */}
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                          <div className="flex flex-col">
                            <span>{formatDate(tx.created_at)}</span>
                            <span className="text-[10px] opacity-70">{formatTime(tx.created_at)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{tx.student_name}</TableCell>
                        <TableCell className="text-sm">{tx.subject_name}</TableCell>
                        <TableCell className="text-end text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatAmount(tx.teacher_share, tx.currency)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`whitespace-nowrap ${STATUS_COLOR[tx.status]}`}
                          >
                            {t(`financial.status.${tx.status}`)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile stacked cards (below md) */}
              <div className="md:hidden divide-y">
                {filteredAndSorted.map((tx) => (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{tx.student_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{tx.subject_name}</p>
                        {/* v112: op code on mobile */}
                        <code className="font-mono text-[10px] text-sky-700 dark:text-sky-300 mt-0.5 inline-block">
                          {formatOpCode(tx.id)}
                        </code>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 ${STATUS_COLOR[tx.status]}`}
                      >
                        {t(`financial.status.${tx.status}`)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {/* v112: date + time on mobile */}
                      <span dir="ltr">{formatDateTime(tx.created_at)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-dashed">
                      <MobileRow label={t('financial.table.teacherShare')} value={formatAmount(tx.teacher_share, tx.currency)} valueClass="text-emerald-700 dark:text-emerald-400" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          )}

          {/* Inline error with previous data still visible */}
          {error && data && (
            <div className="border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-center justify-between gap-2">
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </p>
              <Button onClick={fetchData} variant="ghost" size="sm" className="h-7 text-xs">
                <RefreshCw className="h-3 w-3 me-1" />
                {t('financial.errors.retry')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Sub-components ───
function SummaryCard({
  icon,
  label,
  value,
  color,
  iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  iconBg: string;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.03, y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className={`rounded-xl shadow-md ${color} border-0`}
    >
      <div className="flex items-center gap-3 p-3 sm:p-4">
        <div className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg ${iconBg} backdrop-blur-sm`}>
          {icon}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs sm:text-sm font-medium opacity-90 truncate">{label}</span>
          <span className="text-base sm:text-lg font-bold leading-tight">{value}</span>
        </div>
      </div>
    </motion.div>
  );
}

function MobileRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${valueClass ?? ''}`}>{value}</p>
    </div>
  );
}
