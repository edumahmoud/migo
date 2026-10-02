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
} from 'lucide-react';

import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
}

interface Summary {
  total_gross: string;
  total_teacher_share: string;
  total_platform_share: string;
  total_gateway_fee: string;
  transaction_count: number;
  settled_count: number;
  paid_count: number;
  refunded_count: number;
  reversed_count: number;
  pending_count: number;
  failed_count: number;
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

  const summary = data?.summary;
  const transactions = data?.transactions ?? [];
  const subjectOptions = data?.subjects ?? [];

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

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
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
            icon={<Banknote className="h-5 w-5" />}
            label={t('financial.summary.platformShare')}
            value={formatAmount(summary.total_platform_share)}
            color="bg-gradient-to-br from-violet-500 to-violet-600 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Receipt className="h-5 w-5" />}
            label={t('financial.summary.gatewayFee')}
            value={formatAmount(summary.total_gateway_fee)}
            color="bg-gradient-to-br from-amber-400 to-amber-500 text-white"
            iconBg="bg-white/25"
          />
          <SummaryCard
            icon={<Receipt className="h-5 w-5" />}
            label={t('financial.summary.transactions')}
            value={String(summary.transaction_count)}
            color="bg-gradient-to-br from-rose-400 to-rose-500 text-white"
            iconBg="bg-white/25"
          />
        </div>
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

      {/* Transactions Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('financial.table.empty').split('.')[0]}</CardTitle>
          <CardDescription className="sr-only">{t('financial.subtitle')}</CardDescription>
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

          {!loading && transactions.length > 0 && (
            <>
              {/* Desktop table (md+) */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('financial.table.date')}</TableHead>
                      <TableHead>{t('financial.table.student')}</TableHead>
                      <TableHead>{t('financial.table.course')}</TableHead>
                      <TableHead className="text-end">{t('financial.table.gross')}</TableHead>
                      <TableHead className="text-end">{t('financial.table.teacherShare')}</TableHead>
                      <TableHead className="text-end">{t('financial.table.platformShare')}</TableHead>
                      <TableHead className="text-end">{t('financial.table.gatewayFee')}</TableHead>
                      <TableHead>{t('financial.table.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(tx.created_at)}
                        </TableCell>
                        <TableCell className="font-medium">{tx.student_name}</TableCell>
                        <TableCell className="text-sm">{tx.subject_name}</TableCell>
                        <TableCell className="text-end font-semibold whitespace-nowrap">
                          {formatAmount(tx.gross_amount, tx.currency)}
                        </TableCell>
                        <TableCell className="text-end text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatAmount(tx.teacher_share, tx.currency)}
                        </TableCell>
                        <TableCell className="text-end text-muted-foreground whitespace-nowrap">
                          {formatAmount(tx.platform_share, tx.currency)}
                        </TableCell>
                        <TableCell className="text-end text-muted-foreground whitespace-nowrap">
                          {formatAmount(tx.gateway_fee, tx.currency)}
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
                {transactions.map((tx) => (
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
                      </div>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 ${STATUS_COLOR[tx.status]}`}
                      >
                        {t(`financial.status.${tx.status}`)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatDate(tx.created_at)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-dashed">
                      <MobileRow label={t('financial.table.gross')} value={formatAmount(tx.gross_amount, tx.currency)} />
                      <MobileRow label={t('financial.table.teacherShare')} value={formatAmount(tx.teacher_share, tx.currency)} valueClass="text-emerald-700 dark:text-emerald-400" />
                      <MobileRow label={t('financial.table.platformShare')} value={formatAmount(tx.platform_share, tx.currency)} />
                      <MobileRow label={t('financial.table.gatewayFee')} value={formatAmount(tx.gateway_fee, tx.currency)} />
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
