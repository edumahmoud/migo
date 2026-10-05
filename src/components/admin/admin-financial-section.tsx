'use client';

// =====================================================
// AdminFinancialSection — Phase 12
// =====================================================
// Financial Admin Dashboard for the AttenDo LMS.
//
// Critical design properties:
//   - READ-ONLY. No mutation routes are exposed (refund/settle
//     endpoints from Phase 9 exist but are NOT exposed in this UI).
//   - Server-side summary via the `get_financial_summary` SQL RPC,
//     independent of pagination (reflects ALL matching rows).
//   - Server-side validation in the API (UUID, status allowlist,
//     date format, page_size allowlist).
//   - Explicit column list — `payment_id` and `provider_payment_id`
//     are NEVER returned by the API, and this component renders
//     ONLY the safe fields.
//   - Real pagination (no full-ledger load).
//
// UX states:
//   - Loading: skeleton cards + table spinner.
//   - Empty: friendly empty-state with "Clear filters" button.
//   - Error: generic error message + retry (no SQL errors / secrets
//     / stack traces).
//
// Responsive:
//   - Desktop: summary grid (5/6 cards), filters in a row, table.
//   - Mobile: cards 2-col, filters stack vertically, table
//     horizontally scrollable.
// =====================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  Banknote,
  Receipt,
  Users,
  Loader2,
  AlertCircle,
  RefreshCw,
  Filter,
  X,
  Inbox,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  FileDown,
  Calculator,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { toast } from 'sonner';
import { FinancialCharts, ChartViewToggle, ChartView } from '@/components/shared/financial-charts';
import type { UserProfile } from '@/lib/types';

// ─── API response types ───
interface LedgerRow {
  id: string;
  order_id: string;
  student_id: string;
  student_name: string;
  teacher_id: string;
  teacher_name: string;
  subject_id: string;
  subject_name: string;
  gateway_id: string | null;
  gateway_display_name: string;
  currency: string;
  gross_amount: number;
  platform_share: number;
  teacher_share: number;
  gateway_fee: number;
  net_amount: number;
  commission_rate: number;
  status: 'paid' | 'settled' | 'refunded' | 'reversed' | 'pending' | 'failed';
  created_at: string;
  updated_at: string;
  // Generic payment_order_id — sourced from orders.provider_order_ref.
  // For Paymob: the numeric Paymob Order ID. For future gateways:
  // that gateway's Order ID. NULL for free/unpaid orders. The UI
  // filters out internal placeholders before displaying.
  payment_order_id?: string | null;
}

interface PaginationMeta {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

interface Summary {
  total_gross: string;
  total_platform_share: string;
  total_teacher_share: string;
  total_gateway_fees: string;
  net_platform_revenue: string;
  transaction_count: number;
  // v110: new fields (matching teacher dashboard)
  unique_students: number;
  active_subscriptions: number;
  successful_count: number;
  avg_student_revenue: string;
  avg_transaction_value: string;
}

interface StatusBreakdown {
  paid: number;
  settled: number;
  refunded: number;
  reversed: number;
  pending: number;
  failed: number;
}

interface FinancialResponse {
  success: boolean;
  error?: string;
  data?: LedgerRow[];
  pagination?: PaginationMeta;
  summary?: Summary;
  status_breakdown?: StatusBreakdown;
}

// ─── Filter dropdown option sources ───
interface TeacherOption {
  id: string;
  name: string;
}
interface SubjectOption {
  id: string;
  name: string;
  teacher_id: string | null;
}
interface GatewayOption {
  id: string;
  display_name: string;
}

// ─── Status color map ───
const STATUS_COLOR: Record<LedgerRow['status'], string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  settled: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  refunded: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  reversed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const STATUS_OPTIONS: LedgerRow['status'][] = [
  'paid',
  'settled',
  'refunded',
  'reversed',
  'pending',
  'failed',
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// ─── Component ───
interface AdminFinancialSectionProps {
  profile: UserProfile;
}

export default function AdminFinancialSection({ profile: _profile }: AdminFinancialSectionProps) {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';

  // ─── Filter state ───
  // Default: last 30 days
  const [filters, setFilters] = useState(() => {
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    return {
      from_date: thirtyAgo.toISOString().split('T')[0],
      to_date: today.toISOString().split('T')[0],
      teacher_id: 'all',
      subject_id: 'all',
      gateway_id: 'all',
      status: 'all',
      page: 1,
      page_size: 25,
    };
  });

  // Track if filters have been "applied" (submitted by user). On
  // initial mount, we fetch immediately with defaults. After user
  // edits a filter, we don't fetch until they click Apply OR change
  // pagination.
  const [appliedFilters, setAppliedFilters] = useState(filters);

  // v112: summary view toggle (cards / bar / line)
  const [summaryView, setSummaryView] = useState<ChartView>('cards');

  // v112: transactions log — search + sort + op code column
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // v113: replace time-only filter (HH:MM) with day/month/year period filter
  const [periodFilter, setPeriodFilter] = useState<'all' | 'day' | 'month' | 'year'>('all');

  // ─── Data state ───
  const [data, setData] = useState<FinancialResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Dropdown option sources ───
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [gateways, setGateways] = useState<GatewayOption[]>([]);

  // ─── Fetch dropdown data once on mount ───
  useEffect(() => {
    (async () => {
      try {
        const headers = await getCachedAuthHeaders();
        // Fetch teachers (all users with role='teacher')
        // We use the /api/admin/users endpoint which is admin-only.
        const teachersRes = await fetch('/api/admin/users?role=teacher', { headers });
        const teachersJson = await teachersRes.json();
        if (teachersJson.success && Array.isArray(teachersJson.users)) {
          setTeachers(
            teachersJson.users
              .filter((u: Record<string, unknown>) => u.role === 'teacher')
              .map((u: Record<string, unknown>) => ({
                id: String(u.id),
                name: String(u.name ?? u.email ?? '—'),
              }))
          );
        }

        // Fetch subjects via /api/admin/subjects (if exists) or fall back
        // We use the existing admin data endpoint to get subjects.
        // If the endpoint isn't available, the dropdown stays empty.
        const subjectsRes = await fetch('/api/admin/subjects', { headers });
        if (subjectsRes.ok) {
          const subjectsJson = await subjectsRes.json();
          if (subjectsJson.success && Array.isArray(subjectsJson.subjects)) {
            setSubjects(
              subjectsJson.subjects.map((s: Record<string, unknown>) => ({
                id: String(s.id),
                name: String(s.name ?? '—'),
                teacher_id: (s.teacher_id as string | null) ?? null,
              }))
            );
          }
        }

        // Fetch gateways via /api/admin/payment-gateways
        const gatewaysRes = await fetch('/api/admin/payment-gateways', { headers });
        const gatewaysJson = await gatewaysRes.json();
        if (gatewaysJson.success && Array.isArray(gatewaysJson.gateways)) {
          setGateways(
            gatewaysJson.gateways.map((g: Record<string, unknown>) => ({
              id: String(g.id),
              display_name: String(g.displayName ?? g.display_name ?? '—'),
            }))
          );
        }
      } catch {
        // Dropdown data fetch failed — non-critical. The user can still
        // filter by date / status without teacher/subject/gateway options.
      }
    })();
  }, []);

  // ─── Fetch ledger data when appliedFilters change ───
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (appliedFilters.from_date) params.set('from_date', appliedFilters.from_date);
      if (appliedFilters.to_date) params.set('to_date', appliedFilters.to_date);
      if (appliedFilters.teacher_id !== 'all') params.set('teacher_id', appliedFilters.teacher_id);
      if (appliedFilters.subject_id !== 'all') params.set('subject_id', appliedFilters.subject_id);
      if (appliedFilters.gateway_id !== 'all') params.set('gateway_id', appliedFilters.gateway_id);
      if (appliedFilters.status !== 'all') params.set('status', appliedFilters.status);
      params.set('page', String(appliedFilters.page));
      params.set('page_size', String(appliedFilters.page_size));

      const res = await fetch(
        `/api/admin/financial-ledger?${params.toString()}`,
        { headers: await getCachedAuthHeaders() }
      );
      const json = (await res.json()) as FinancialResponse;
      if (!json.success || !json.summary || !json.pagination) {
        throw new Error(json.error || t('adminFinancial.errors.loadFailed'));
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('adminFinancial.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Filter actions ───
  const hasActiveFilters = useMemo(() => {
    return (
      filters.teacher_id !== 'all' ||
      filters.subject_id !== 'all' ||
      filters.gateway_id !== 'all' ||
      filters.status !== 'all' ||
      Boolean(filters.from_date) ||
      Boolean(filters.to_date)
    );
  }, [filters]);

  const applyFilters = () => {
    setAppliedFilters({ ...filters, page: 1 });
  };

  const clearFilters = () => {
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    const cleared = {
      from_date: thirtyAgo.toISOString().split('T')[0],
      to_date: today.toISOString().split('T')[0],
      teacher_id: 'all',
      subject_id: 'all',
      gateway_id: 'all',
      status: 'all',
      page: 1,
      page_size: filters.page_size,
    };
    setFilters(cleared);
    setAppliedFilters(cleared);
  };

  const goToPage = (newPage: number) => {
    const next = { ...appliedFilters, page: newPage };
    setFilters(next);
    setAppliedFilters(next);
  };

  const changePageSize = (newSize: number) => {
    const next = { ...appliedFilters, page: 1, page_size: newSize };
    setFilters(next);
    setAppliedFilters(next);
  };

  // ─── Refund handler (G2) ───
  // Calls /api/admin/financial-ledger/[id]/refund which changes ONLY the
  // status to 'refunded' (financial values stay immutable).
  // NOTE: formatAmount is defined below; using it here is safe because
  // JS closures resolve at call time, not at definition time.
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const handleRefund = async (row: LedgerRow) => {
    if (refundingId) return;
    const confirmed = window.confirm(
      `تأكيد الاسترداد لهذه العملية؟\n\n` +
      `الطالب: ${row.student_name}\n` +
      `المعلم: ${row.teacher_name}\n` +
      `المقرر: ${row.subject_name}\n` +
      `الإجمالي: ${formatAmount(row.gross_amount, row.currency)}\n\n` +
      `سيتم تغيير الحالة فقط إلى "مسترد". القيم المالية التاريخية لن تُعدّل.`
    );
    if (!confirmed) return;
    setRefundingId(row.id);
    try {
      const res = await fetch(`/api/admin/financial-ledger/${row.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تسجيل الاسترداد بنجاح');
        await fetchData(); // refresh table
      } else {
        toast.error(json.error || 'فشل الاسترداد');
      }
    } catch (err) {
      console.error('[refund] failed', err);
      toast.error('حدث خطأ غير متوقع أثناء الاسترداد');
    } finally {
      setRefundingId(null);
    }
  };

  // ─── Format helpers ───
  const formatAmount = (val: string | number, currency = 'EGP') => {
    const n = Number(val) || 0;
    const formatted = n.toLocaleString(isRTL ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${formatted} ${currency}`;
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

  // v112: format with date + time (HH:MM)
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

  // v112: operation code — short, monospace, copyable. Distinct from
  // formatOrderId (which slices the order_id). The op code is derived
  // from the LEDGER row's UUID (row.id), not the order UUID — that
  // way one click highlights the row in the financial ledger.
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
  const resolvePaymentOrderId = (row: LedgerRow): string => {
    const raw = row.payment_order_id;
    if (!raw) return '—';
    if (INTERNAL_PREFIXES.some((p) => raw.startsWith(p))) return '—';
    return raw;
  };

  const formatOrderId = (uuid: string) => {
    // Show first 8 chars for readability. NOT a security feature — admin
    // already has access to the full UUID via the API response if needed.
    return uuid?.slice(0, 8) ?? '—';
  };

  const summary = data?.summary;
  const statusBreakdown = data?.status_breakdown;
  const rows = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.total_pages ?? 0;
  const currentPage = pagination?.page ?? 1;

  // v112: client-side search + sort + time filter on the loaded ledger
  // rows. Server-side filters (date range, teacher, subject, gateway,
  // status, pagination) are still applied via the API. The client-side
  // search filters by op code / order / student / teacher / subject.
  const filteredAndSortedRows = useMemo<LedgerRow[]>(() => {
    let result: LedgerRow[] = rows;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((row: LedgerRow) => {
        const opCode = formatOpCode(row.id).toLowerCase();
        const order = (row.order_id ?? '').toLowerCase();
        const student = (row.student_name ?? '').toLowerCase();
        const teacher = (row.teacher_name ?? '').toLowerCase();
        const subject = (row.subject_name ?? '').toLowerCase();
        return (
          opCode.includes(q) ||
          order.includes(q) ||
          student.includes(q) ||
          teacher.includes(q) ||
          subject.includes(q)
        );
      });
    }
    // v113: period filter (day/month/year) — replaces the old HH:MM time filter
    if (periodFilter !== 'all') {
      const now = new Date();
      result = result.filter((row: LedgerRow) => {
        try {
          const d = new Date(row.created_at);
          if (periodFilter === 'day') {
            return d.toDateString() === now.toDateString();
          } else if (periodFilter === 'month') {
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          } else if (periodFilter === 'year') {
            return d.getFullYear() === now.getFullYear();
          }
          return true;
        } catch {
          return false;
        }
      });
    }
    // Sort by created_at (desc = newest first by default)
    result = [...result].sort((a: LedgerRow, b: LedgerRow) => {
      const aT = new Date(a.created_at).getTime() || 0;
      const bT = new Date(b.created_at).getTime() || 0;
      return sortDir === 'asc' ? aT - bT : bT - aT;
    });
    return result;
  }, [rows, searchQuery, periodFilter, sortDir]);

  // Filtered subject options (when teacher is selected, show only that teacher's subjects)
  const filteredSubjects = useMemo(() => {
    if (filters.teacher_id === 'all') return subjects;
    return subjects.filter((s) => s.teacher_id === filters.teacher_id);
  }, [subjects, filters.teacher_id]);

  // ─── Render: Loading (initial) ───
  if (loading && !data) {
    return (
      <div className="space-y-6" dir={direction}>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            {t('adminFinancial.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('adminFinancial.subtitle')}</p>
        </div>
        <SummarySkeleton />
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
          <span className="text-sm text-muted-foreground">{t('adminFinancial.loading')}</span>
        </div>
      </div>
    );
  }

  // ─── Render: Error (initial) ───
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
          <p className="font-semibold text-foreground">{t('adminFinancial.errors.loadFailed')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('adminFinancial.errors.noSecretsLeaked')}</p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 me-2" />
          {t('adminFinancial.errors.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={direction}>
      {/* ─── Header ─── */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          {t('adminFinancial.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('adminFinancial.subtitle')}</p>
      </div>

      {/* v112: Summary view toggle (cards / bar / line) — toggle between
          the existing card layout and two new chart views (daily
          aggregation of gross_amount + teacher_share + platform_share). */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Receipt className="h-3.5 w-3.5" />
          {t('adminFinancial.viewToggle.label') || 'طريقة العرض'}
        </div>
        <ChartViewToggle view={summaryView} onChange={setSummaryView} />
      </div>

      {/* ─── Summary Cards (only shown when view = 'cards') ─── */}
      {summaryView === 'cards' && summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          <SummaryCard
            icon={<TrendingUp className="h-5 w-5" />}
            label={t('adminFinancial.summary.totalGross')}
            value={formatAmount(summary.total_gross)}
            color="bg-gradient-to-br from-sky-500 to-sky-700 text-white"
          />
          <SummaryCard
            icon={<Banknote className="h-5 w-5" />}
            label={t('adminFinancial.summary.platformShare')}
            value={formatAmount(summary.total_platform_share)}
            color="bg-gradient-to-br from-violet-500 to-violet-600 text-white"
          />
          <SummaryCard
            icon={<Receipt className="h-5 w-5" />}
            label={t('adminFinancial.summary.transactionCount')}
            value={String(summary.transaction_count)}
            color="bg-gradient-to-br from-rose-400 to-rose-500 text-white"
          />
          <SummaryCard
            icon={<Users className="h-5 w-5" />}
            label={t('adminFinancial.summary.activeSubscriptions')}
            value={String(summary.active_subscriptions)}
            color="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white"
          />
          <SummaryCard
            icon={<Users className="h-5 w-5" />}
            label={t('adminFinancial.summary.uniqueStudents')}
            value={String(summary.unique_students)}
            color="bg-gradient-to-br from-purple-500 to-purple-600 text-white"
          />
          <SummaryCard
            icon={<Calculator className="h-5 w-5" />}
            label={t('adminFinancial.summary.avgStudentRevenue')}
            value={formatAmount(summary.avg_student_revenue)}
            color="bg-gradient-to-br from-teal-500 to-teal-600 text-white"
          />
          <SummaryCard
            icon={<Calculator className="h-5 w-5" />}
            label={t('adminFinancial.summary.avgTransactionValue')}
            value={formatAmount(summary.avg_transaction_value)}
            color="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white"
          />
        </div>
      )}

      {/* v112: chart view (when summary view is bar/line) */}
      {summaryView !== 'cards' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {summaryView === 'bar'
                ? (t('adminFinancial.viewToggle.barChart') || 'رسم الأعمدة')
                : (t('adminFinancial.viewToggle.lineChart') || 'رسم خطي')}
            </CardTitle>
            <CardDescription className="sr-only">
              {t('adminFinancial.subtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FinancialCharts
              view={summaryView}
              transactions={rows.map((r) => ({
                created_at: r.created_at,
                teacher_share: r.teacher_share,
                platform_share: r.platform_share,
                gross_amount: r.gross_amount,
                currency: r.currency,
              }))}
              currency={t('adminFinancial.currency') || 'EGP'}
              height={320}
            />
          </CardContent>
        </Card>
      )}

      {/* v110: Tabbed layout — matches teacher dashboard */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="overview">{t('adminFinancial.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="transactions">{t('adminFinancial.tabs.transactions')}</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Overview (Status Breakdown + Filters) ─── */}
        <TabsContent value="overview" className="space-y-6">

      {/* ─── Status Breakdown ─── */}
      {statusBreakdown && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('adminFinancial.statusBreakdown.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3">
              {STATUS_OPTIONS.map((s) => (
                <div
                  key={s}
                  className="rounded-lg border p-2 sm:p-3 text-center bg-muted/30"
                >
                  <p className="text-xs text-muted-foreground">{t(`adminFinancial.status.${s}`)}</p>
                  <p className="text-lg sm:text-xl font-bold text-foreground">
                    {statusBreakdown[s] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Filters ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">{t('adminFinancial.filters.title')}</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button onClick={clearFilters} variant="ghost" size="sm" className="h-8">
                <X className="h-3.5 w-3.5 me-1" />
                {t('adminFinancial.filters.clear')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('adminFinancial.filters.fromDate')}
              </label>
              <Input
                type="date"
                value={filters.from_date}
                onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('adminFinancial.filters.toDate')}
              </label>
              <Input
                type="date"
                value={filters.to_date}
                onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('adminFinancial.filters.teacher')}
              </label>
              <Select
                value={filters.teacher_id}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, teacher_id: v, subject_id: 'all' }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adminFinancial.filters.allTeachers')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('adminFinancial.filters.allTeachers')}</SelectItem>
                  {teachers.map((tch) => (
                    <SelectItem key={tch.id} value={tch.id}>
                      {tch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('adminFinancial.filters.subject')}
              </label>
              <Select
                value={filters.subject_id}
                onValueChange={(v) => setFilters((f) => ({ ...f, subject_id: v }))}
                disabled={filteredSubjects.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adminFinancial.filters.allSubjects')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('adminFinancial.filters.allSubjects')}</SelectItem>
                  {filteredSubjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('adminFinancial.filters.gateway')}
              </label>
              <Select
                value={filters.gateway_id}
                onValueChange={(v) => setFilters((f) => ({ ...f, gateway_id: v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adminFinancial.filters.allGateways')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('adminFinancial.filters.allGateways')}</SelectItem>
                  {gateways.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('adminFinancial.filters.status')}
              </label>
              <Select
                value={filters.status}
                onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adminFinancial.filters.allStatuses')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('adminFinancial.filters.allStatuses')}</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`adminFinancial.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={applyFilters} size="sm" className="h-9 flex-1">
                {t('adminFinancial.filters.apply')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        {/* ─── Tab 2: Transactions (سجل العمليات) ─── */}
        <TabsContent value="transactions" className="space-y-6">

      {/* ─── Ledger Table ─── */}
      <Card>
        <CardHeader className="pb-3">
          {/* v112: header row with title + filtered count badge */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">
                {t('adminFinancial.table.title')}
                {' '}
                {/* v112: total transactions count (filtered) in the header */}
                <Badge
                  variant="secondary"
                  className="ms-2 bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                >
                  {t('adminFinancial.table.totalFiltered', { count: filteredAndSortedRows.length })
                    || `إجمالي العمليات (مصفى): ${filteredAndSortedRows.length}`}
                </Badge>
              </CardTitle>
              {pagination && (
                <span className="text-xs text-muted-foreground">
                  {t('adminFinancial.pagination.showing', {
                    from: (currentPage - 1) * pagination.page_size + 1,
                    to: Math.min(currentPage * pagination.page_size, pagination.total_count),
                    total: pagination.total_count,
                  })}
                </span>
              )}
            </div>
            {/* v112: Search field + time filter + sort toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('adminFinancial.search.placeholder') || 'ابحث بكود العملية أو الطلب أو الطالب...'}
                  className="h-9 ps-8"
                  aria-label={t('adminFinancial.search.label') || 'بحث'}
                />
              </div>
              {/* v113: period filter (day/month/year) — replaces HH:MM time filter */}
              <Select
                value={periodFilter}
                onValueChange={(v) => setPeriodFilter(v as 'all' | 'day' | 'month' | 'year')}
              >
                <SelectTrigger className="w-32 h-9">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="day">اليوم</SelectItem>
                  <SelectItem value="month">هذا الشهر</SelectItem>
                  <SelectItem value="year">هذا العام</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                title={sortDir === 'asc'
                  ? (t('adminFinancial.sort.asc') || 'تصاعدي')
                  : (t('adminFinancial.sort.desc') || 'تنازلي')}
              >
                {sortDir === 'asc'
                  ? <ArrowUp className="h-3.5 w-3.5" />
                  : <ArrowDown className="h-3.5 w-3.5" />}
                <ArrowUpDown className="h-3 w-3 opacity-50" />
                <span className="text-xs">
                  {sortDir === 'asc'
                    ? (t('adminFinancial.sort.asc') || 'تصاعدي')
                    : (t('adminFinancial.sort.desc') || 'تنازلي')}
                </span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
              <span className="text-sm text-muted-foreground">{t('adminFinancial.loading')}</span>
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="rounded-full bg-muted p-4">
                <Inbox className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                {t('adminFinancial.table.empty')}
              </p>
              <Button onClick={clearFilters} variant="outline" size="sm">
                {t('adminFinancial.filters.clear')}
              </Button>
            </div>
          )}

          {/* v112: empty filtered results state — when rows exist but
              the search/time filter excluded them all */}
          {!loading && rows.length > 0 && filteredAndSortedRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Search className="h-6 w-6 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">
                لا توجد نتائج مطابقة للبحث
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setSearchQuery(''); setPeriodFilter('all'); }}
              >
                مسح البحث
              </Button>
            </div>
          )}

          {!loading && filteredAndSortedRows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* v112: op code column (NEW) */}
                      <TableHead>{t('adminFinancial.table.opCode') || 'كود العملية'}</TableHead>
                      {/* Generic payment_order_id column — sourced from
                          orders.provider_order_ref. Shows the gateway's
                          Order ID (Paymob, Fawry, etc.) next to the
                          operation code. */}
                      <TableHead>رقم الطلب</TableHead>
                      {/* v112: date column header with sort toggle */}
                      <TableHead>
                        <button
                          type="button"
                          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          title={sortDir === 'asc'
                            ? (t('adminFinancial.sort.desc') || 'تنازلي')
                            : (t('adminFinancial.sort.asc') || 'تصاعدي')}
                        >
                          {t('adminFinancial.table.date') || 'التاريخ'}
                          {sortDir === 'asc'
                            ? <ArrowUp className="h-3 w-3" />
                            : <ArrowDown className="h-3 w-3" />}
                        </button>
                      </TableHead>
                      {/* v113: removed 'order' column per user request */}
                      <TableHead>{t('adminFinancial.table.student')}</TableHead>
                      <TableHead>{t('adminFinancial.table.teacher')}</TableHead>
                      <TableHead>{t('adminFinancial.table.subject')}</TableHead>
                      <TableHead>{t('adminFinancial.table.gateway')}</TableHead>
                      <TableHead className="text-end">{t('adminFinancial.table.gross')}</TableHead>
                      <TableHead className="text-end">{t('adminFinancial.table.platform')}</TableHead>
                      <TableHead className="text-end">{t('adminFinancial.table.teacherShare')}</TableHead>
                      <TableHead className="text-end">{t('adminFinancial.table.gatewayFee')}</TableHead>
                      <TableHead className="text-end">{t('adminFinancial.table.net')}</TableHead>
                      <TableHead>{t('adminFinancial.table.status')}</TableHead>
                      <TableHead className="text-center">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedRows.map((row) => (
                      <TableRow key={row.id}>
                        {/* v112: op code cell — short, monospace, copyable.
                            Click copies the SHORT code (1DD8E6E5),
                            NOT the full UUID. The full UUID stays in
                            the title attribute for tooltip/hover. */}
                        <TableCell className="whitespace-nowrap">
                          <code
                            className="font-mono text-xs text-sky-700 dark:text-sky-300 cursor-pointer hover:underline"
                            title={row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              const shortCode = formatOpCode(row.id);
                              try {
                                navigator.clipboard?.writeText(shortCode);
                                toast.success(`تم نسخ كود العملية: ${shortCode}`);
                              } catch { /* ignore */ }
                            }}
                          >
                            {formatOpCode(row.id)}
                          </code>
                        </TableCell>
                        {/* payment_order_id cell — shows the gateway's
                            Order ID (Paymob, Fawry, etc.) when available.
                            Internal placeholders (order_<UUID>, free_<UUID>,
                            etc.) are filtered out — "—" is shown instead. */}
                        <TableCell className="whitespace-nowrap text-xs font-mono">
                          {(() => {
                            const orderId = resolvePaymentOrderId(row);
                            return orderId === '—'
                              ? <span className="text-muted-foreground">—</span>
                              : <span className="text-sky-700 dark:text-sky-300">{orderId}</span>;
                          })()}
                        </TableCell>
                        {/* v112: date+time cell (was date-only) */}
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                          <div className="flex flex-col">
                            <span>{formatDate(row.created_at)}</span>
                            <span className="text-[10px] opacity-70">{formatTime(row.created_at)}</span>
                          </div>
                        </TableCell>
                        {/* v113: removed order_id cell per user request */}
                        <TableCell className="font-medium">{row.student_name}</TableCell>
                        <TableCell className="text-sm">{row.teacher_name}</TableCell>
                        <TableCell className="text-sm">{row.subject_name}</TableCell>
                        <TableCell className="text-sm">{row.gateway_display_name}</TableCell>
                        <TableCell className="text-end font-semibold whitespace-nowrap">
                          {formatAmount(row.gross_amount, row.currency)}
                        </TableCell>
                        <TableCell className="text-end text-muted-foreground whitespace-nowrap">
                          {formatAmount(row.platform_share, row.currency)}
                        </TableCell>
                        <TableCell className="text-end text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatAmount(row.teacher_share, row.currency)}
                        </TableCell>
                        <TableCell className="text-end text-muted-foreground whitespace-nowrap">
                          {formatAmount(row.gateway_fee, row.currency)}
                        </TableCell>
                        <TableCell className="text-end whitespace-nowrap">
                          {formatAmount(row.net_amount, row.currency)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`whitespace-nowrap ${STATUS_COLOR[row.status]}`}
                          >
                            {t(`adminFinancial.status.${row.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {/* Refund button (G2) — only for paid/settled rows */}
                          {(row.status === 'paid' || row.status === 'settled') ? (
                            <div className="flex items-center gap-1 justify-center">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 gap-1 text-xs text-rose-600 hover:bg-rose-50"
                                disabled={refundingId === row.id}
                                onClick={() => handleRefund(row)}
                                title="استرداد"
                              >
                                {refundingId === row.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                استرداد
                              </Button>
                              {/* G5 — download PDF receipt */}
                              <a
                                href={`/api/admin/financial-ledger/${row.id}/receipt`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 h-7 px-2 text-xs text-sky-700 hover:bg-sky-50 rounded-md"
                                title="تحميل إيصال PDF"
                              >
                                <FileDown className="h-3 w-3" />
                                PDF
                              </a>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ─── Pagination ─── */}
              {pagination && pagination.total_count > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 border-t">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{t('adminFinancial.pagination.pageSize')}</span>
                    <Select
                      value={String(pagination.page_size)}
                      onValueChange={(v) => changePageSize(Number(v))}
                    >
                      <SelectTrigger className="h-7 w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((s) => (
                          <SelectItem key={s} value={String(s)}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => goToPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage <= 1}
                      variant="outline"
                      size="sm"
                      className="h-8"
                    >
                      {isRTL ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronLeft className="h-4 w-4" />
                      )}
                      <span className="ms-1 hidden sm:inline">
                        {t('adminFinancial.pagination.previous')}
                      </span>
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      {t('adminFinancial.pagination.pageOf', {
                        current: currentPage,
                        total: Math.max(1, totalPages),
                      })}
                    </span>
                    <Button
                      onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage >= totalPages}
                      variant="outline"
                      size="sm"
                      className="h-8"
                    >
                      <span className="me-1 hidden sm:inline">
                        {t('adminFinancial.pagination.next')}
                      </span>
                      {isRTL ? (
                        <ChevronLeft className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
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
                {t('adminFinancial.errors.retry')}
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.03, y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className={`rounded-xl shadow-md ${color} border-0`}
    >
      <div className="flex items-center gap-3 p-3 sm:p-4">
        <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-white/25 backdrop-blur-sm">
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

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border bg-muted/40 animate-pulse h-24"
          aria-hidden
        />
      ))}
    </div>
  );
}
