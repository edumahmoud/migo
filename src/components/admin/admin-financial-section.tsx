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
} from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

      {/* ─── Summary Cards (6) ─── */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <SummaryCard
            icon={<TrendingUp className="h-5 w-5" />}
            label={t('adminFinancial.summary.totalGross')}
            value={formatAmount(summary.total_gross)}
            color="bg-gradient-to-br from-sky-500 to-sky-700 text-white"
          />
          <SummaryCard
            icon={<DollarSign className="h-5 w-5" />}
            label={t('adminFinancial.summary.teacherShare')}
            value={formatAmount(summary.total_teacher_share)}
            color="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
          />
          <SummaryCard
            icon={<Banknote className="h-5 w-5" />}
            label={t('adminFinancial.summary.platformShare')}
            value={formatAmount(summary.total_platform_share)}
            color="bg-gradient-to-br from-violet-500 to-violet-600 text-white"
          />
          <SummaryCard
            icon={<Receipt className="h-5 w-5" />}
            label={t('adminFinancial.summary.gatewayFees')}
            value={formatAmount(summary.total_gateway_fees)}
            color="bg-gradient-to-br from-amber-400 to-amber-500 text-white"
          />
          <SummaryCard
            icon={<DollarSign className="h-5 w-5" />}
            label={t('adminFinancial.summary.netPlatformRevenue')}
            value={formatAmount(summary.net_platform_revenue)}
            color="bg-gradient-to-br from-teal-500 to-teal-600 text-white"
          />
          <SummaryCard
            icon={<Receipt className="h-5 w-5" />}
            label={t('adminFinancial.summary.transactionCount')}
            value={String(summary.transaction_count)}
            color="bg-gradient-to-br from-rose-400 to-rose-500 text-white"
          />
        </div>
      )}

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

      {/* ─── Ledger Table ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{t('adminFinancial.table.title')}</CardTitle>
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

          {!loading && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('adminFinancial.table.date')}</TableHead>
                      <TableHead>{t('adminFinancial.table.order')}</TableHead>
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(row.created_at)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{formatOrderId(row.order_id)}</TableCell>
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
