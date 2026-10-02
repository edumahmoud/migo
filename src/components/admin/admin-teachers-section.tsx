'use client';

/**
 * Admin Teacher Accounts Section
 *
 * Provides a paginated, searchable list of teacher accounts with
 * financial summary + payout methods. Uses server-side pagination
 * to handle LARGE numbers of teachers without loading them all into
 * the browser.
 *
 * Flow:
 *   1. Admin opens the section → fetches page 1 of teachers
 *   2. Admin can search by name/email → server-side ILIKE filter
 *   3. Admin clicks a teacher → fetches detailed info (payout methods + financial summary)
 *   4. Detail view shows: account info, payout methods (masked), financial summary,
 *      recent transactions (last 10)
 *
 * Security:
 *   - All API calls go through requireAdmin (server-side authorization)
 *   - Payout method encrypted details are NEVER returned by the API
 *   - Only masked summaries (last4, card_brand, wallet_number) are shown
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Users, Search, ChevronLeft, ChevronRight,
  Wallet, DollarSign, Clock, CheckCircle2, X, Eye, EyeOff,
  HandCoins, Banknote, History, Copy, Download, FileSpreadsheet,
} from 'lucide-react';

// Arabic labels for payout method detail fields
const FIELD_LABELS_AR: Record<string, string> = {
  wallet_number: 'رقم المحفظة',
  bank_name: 'اسم البنك',
  account_number: 'رقم الحساب',
  iban: 'IBAN',
  holder_name: 'اسم صاحب الحساب',
  last4: 'آخر 4 أرقام',
  card_brand: 'نوع البطاقة',
  expiry_month: 'شهر الانتهاء',
  expiry_year: 'سنة الانتهاء',
  recipient_identifier: 'معرّف المستلم',
};
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface TeacherRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  account_status: string;
  created_at: string;
  auto_payout_enabled: boolean;
  subject_count: number;
  student_count: number;
  total_revenue: number;        // backward compat (alias of total_earned)
  total_earned: number;         // ALL money (paid + settled)
  total_settled: number;        // actually sent to teacher
  total_pending: number;        // available for payout (in platform account)
}

interface Pagination {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

export default function AdminTeachersSection() {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [teacherDetail, setTeacherDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Settlement + delivery + transactions state
  const [settlingTeacherId, setSettlingTeacherId] = useState<string | null>(null);
  const [deliveringTeacherId, setDeliveringTeacherId] = useState<string | null>(null);
  const [transactionsModal, setTransactionsModal] = useState<{ open: boolean; teacherId: string | null; teacherName: string | null }>({ open: false, teacherId: null, teacherName: null });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/admin/teachers?${params}`, { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setTeachers(json.data ?? []);
      setPagination(json.pagination ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchQuery]);

  useEffect(() => { fetchTeachers(); }, [fetchTeachers]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== searchQuery) {
        setPage(1);
        setSearchQuery(searchInput);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, searchQuery]);

  const fetchTeacherDetail = useCallback(async (teacherId: string) => {
    setDetailLoading(true);
    setSelectedTeacherId(teacherId);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}`, { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setTeacherDetail(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Settlement handler (manual — admin records money sent outside system) ──
  const handleSettle = async (teacherId: string, amount: number) => {
    if (settlingTeacherId) return;
    if (!confirm(`تأكيد التسوية: ${amount.toFixed(2)} EGP لهذا المعلم؟`)) return;
    setSettlingTeacherId(teacherId);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ amount }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تمت التسوية بنجاح');
        await fetchTeachers(); // refresh list
        if (selectedTeacherId === teacherId) await fetchTeacherDetail(teacherId);
      } else {
        toast.error(json.error || 'فشلت التسوية');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSettlingTeacherId(null);
    }
  };

  // ── Deliver payment handler (through the payout system) ──
  const handleDeliverPayment = async (teacherId: string, amount: number, payoutMethodId: string) => {
    if (deliveringTeacherId) return;
    if (!confirm(`تأكيد تسليم الدفعة: ${amount.toFixed(2)} EGP عبر وسيلة الاستلام؟`)) return;
    setDeliveringTeacherId(teacherId);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/deliver-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ amount, payout_method_id: payoutMethodId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إنشاء أمر التسليم');
        await fetchTeachers();
      } else {
        toast.error(json.error || 'فشل تسليم الدفعة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setDeliveringTeacherId(null);
    }
  };

  // ── Fetch transactions log for a teacher ──
  const fetchTransactions = async (teacherId: string, teacherName: string | null) => {
    setTransactionsModal({ open: true, teacherId, teacherName });
    setTransactionsLoading(true);
    setTransactions([]);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/transactions`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setTransactions(json.transactions ?? []);
      } else {
        toast.error(json.error || 'تعذّر جلب المعاملات');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTransactionsLoading(false);
    }
  };

  // ── Per-teacher Excel export (N2) ──
  // Generates an Excel workbook with two sheets:
  //   Sheet 1: Teacher summary (name, email, subject_count, student_count, totals)
  //   Sheet 2: All financial_ledger entries for this teacher (filtered by status=paid|settled)
  const [exportingTeacherId, setExportingTeacherId] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  // G3 — bulk settle: per-row checkbox + bulk settle action
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set());
  const [bulkSettling, setBulkSettling] = useState(false);

  // Auto-payout feature flags (read once on mount; reflects env vars)
  // We can't read env vars directly from the client, so we infer them
  // from the per-teacher toggle endpoint's response field
  // `feature_globally_enabled` + `paymob_configured`. Until then, we
  // assume the platform-wide toggle is on (admin can verify in Vercel).
  const [bulkToggling, setBulkToggling] = useState(false);
  const [togglingTeacherId, setTogglingTeacherId] = useState<string | null>(null);
  const [autoPayoutWarnings, setAutoPayoutWarnings] = useState<Record<string, string>>({});

  const toggleAutoPayout = async (teacherId: string, currentEnabled: boolean) => {
    if (togglingTeacherId) return;
    setTogglingTeacherId(teacherId);
    const newEnabled = !currentEnabled;
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/auto-payout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      const json = await res.json();
      if (json.success) {
        // Optimistically update the local state
        setTeachers((prev) => prev.map((t) =>
          t.id === teacherId ? { ...t, auto_payout_enabled: newEnabled } : t
        ));
        if (json.warning) {
          setAutoPayoutWarnings((prev) => ({ ...prev, [teacherId]: json.warning }));
          toast.warning(json.warning);
        } else {
          setAutoPayoutWarnings((prev) => {
            const next = { ...prev };
            delete next[teacherId];
            return next;
          });
          toast.success(newEnabled
            ? 'تم تفعيل الدفع التلقائي للمعلم'
            : 'تم تعطيل الدفع التلقائي للمعلم');
        }
      } else {
        toast.error(json.error || 'فشل التبديل');
      }
    } catch (err) {
      console.error('[auto-payout-toggle] failed', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setTogglingTeacherId(null);
    }
  };

  const handleBulkToggleAutoPayout = async (enabled: boolean) => {
    if (bulkToggling) return;
    const eligible = teachers.filter((t) => Number(t.total_pending ?? 0) > 0);
    if (eligible.length === 0) {
      toast.error('لا يوجد معلمون لهم مستحقات');
      return;
    }
    const confirmed = window.confirm(
      `تأكيد ${enabled ? 'تفعيل' : 'تعطيل'} الدفع التلقائي لـ ${eligible.length} معلم ` +
      `(الذين لديهم مستحقات)؟`
    );
    if (!confirmed) return;
    setBulkToggling(true);
    try {
      const res = await fetch(`/api/admin/teachers/bulk-toggle-auto-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم ${enabled ? 'تفعيل' : 'تعطيل'} الدفع التلقائي لـ ${json.updated_count} معلم`);
        await fetchTeachers(); // refresh
      } else {
        toast.error(json.error || 'فشل التبديل الجماعي');
      }
    } catch (err) {
      console.error('[bulk-toggle-auto-payout] failed', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setBulkToggling(false);
    }
  };

  const toggleTeacherSelection = (teacherId: string) => {
    setSelectedTeacherIds((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedTeacherIds((prev) => {
      // If all currently-visible teachers are already selected, clear.
      // Otherwise, select all currently-visible teachers.
      const allVisibleIds = teachers.map((t) => t.id);
      const allSelected = allVisibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of allVisibleIds) next.delete(id);
        return next;
      } else {
        const next = new Set(prev);
        for (const id of allVisibleIds) next.add(id);
        return next;
      }
    });
  };

  const handleBulkSettle = async () => {
    if (bulkSettling) return;
    if (selectedTeacherIds.size === 0) {
      toast.error('لم يتم اختيار أي معلم');
      return;
    }

    // Build the settlements payload — one entry per selected teacher,
    // settling their full available pending balance.
    const settlements = teachers
      .filter((t) => selectedTeacherIds.has(t.id) && Number(t.total_pending ?? 0) > 0)
      .map((t) => ({
        teacher_id: t.id,
        amount: Number(t.total_pending ?? 0),
      }));

    if (settlements.length === 0) {
      toast.error('لا توجد مبالغ متاحة للتسوية للمعلمين المحددين');
      return;
    }

    const confirmed = window.confirm(
      `تأكيد التسوية الجماعية لـ ${settlements.length} معلم بإجمالي ` +
      `${settlements.reduce((s, x) => s + x.amount, 0).toFixed(2)} EGP؟`
    );
    if (!confirmed) return;

    setBulkSettling(true);
    try {
      const res = await fetch(`/api/admin/teachers/bulk-settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ settlements }),
      });
      const json = await res.json();
      if (json.success) {
        const { succeeded, failed, total_settled } = json.summary;
        toast.success(
          `تمت تسوية ${succeeded}/${succeeded + failed} معلم بإجمالي ${Number(total_settled).toFixed(2)} EGP`
        );
        setSelectedTeacherIds(new Set()); // clear selection
        await fetchTeachers(); // refresh list
      } else {
        toast.error(json.error || 'فشلت التسوية الجماعية');
      }
    } catch (err) {
      console.error('[bulk-settle] failed', err);
      toast.error('حدث خطأ غير متوقع أثناء التسوية الجماعية');
    } finally {
      setBulkSettling(false);
    }
  };

  const handleExportTeacher = async (teacher: TeacherRow) => {
    setExportingTeacherId(teacher.id);
    try {
      // Fetch all financial_ledger rows for this teacher (paid + settled only)
      const params = new URLSearchParams({
        teacher_id: teacher.id,
        page_size: '100',
      });
      const res = await fetch(`/api/admin/financial-ledger?${params}`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'تعذّر جلب بيانات المعلم');
        return;
      }

      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Sheet 1: Teacher summary
      const summaryData = [
        ['الحقل', 'القيمة'],
        ['الاسم', teacher.name],
        ['البريد الإلكتروني', teacher.email],
        ['الهاتف', teacher.phone ?? '—'],
        ['الحالة', teacher.account_status],
        ['تاريخ التسجيل', new Date(teacher.created_at).toLocaleDateString('ar-EG')],
        ['عدد المقررات', teacher.subject_count],
        ['عدد الطلاب', teacher.student_count],
        ['الإيراد الكلي (مدفوع + مُسوّى)', Number(teacher.total_earned ?? 0).toFixed(2)],
        ['المُسوّى (تم تسليمه)', Number(teacher.total_settled ?? 0).toFixed(2)],
        ['المتاح للصرف', Number(teacher.total_pending ?? 0).toFixed(2)],
        ['عدد العمليات (من السجل)', json.summary?.transaction_count ?? json.data?.length ?? 0],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
      // Set column widths
      ws1['!cols'] = [{ wch: 30 }, { wch: 35 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'ملخص المعلم');

      // Sheet 2: Transactions (financial_ledger rows)
      const ledgerRows = (json.data ?? []) as Array<Record<string, unknown>>;
      if (ledgerRows.length > 0) {
        const headers = ['التاريخ', 'الطالب', 'المقرر', 'الإجمالي', 'حصة المنصة', 'حصة المعلم', 'العملة', 'الحالة', 'العمولة %'];
        const rows = ledgerRows.map((r) => [
          new Date(r.created_at as string).toLocaleDateString('ar-EG'),
          r.student_name ?? '—',
          r.subject_name ?? '—',
          Number(r.gross_amount ?? 0).toFixed(2),
          Number(r.platform_share ?? 0).toFixed(2),
          Number(r.teacher_share ?? 0).toFixed(2),
          r.currency ?? 'EGP',
          r.status ?? '—',
          Number(r.commission_rate ?? 0).toFixed(2),
        ]);
        const txSheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        txSheet['!cols'] = [
          { wch: 14 }, { wch: 22 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, txSheet, 'المعاملات');
      } else {
        // Empty sheet so user gets visual confirmation
        const emptySheet = XLSX.utils.aoa_to_sheet([['لا توجد معاملات لهذا المعلم']]);
        XLSX.utils.book_append_sheet(wb, emptySheet, 'المعاملات');
      }

      const safeName = (teacher.name || 'teacher').replace(/[\\\/:*?"<>|]/g, '_').slice(0, 50);
      const fileName = `teacher_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`تم تصدير ${ledgerRows.length} معاملة إلى ${fileName}`);
    } catch (err) {
      console.error('[export-teacher] failed', err);
      toast.error('تعذّر تصدير Excel للمعلم');
    } finally {
      setExportingTeacherId(null);
    }
  };

  // ── Export ALL teachers (current page) as a single Excel workbook ──
  // Sheet 1: Teachers list with all financial summary columns
  // Sheet 2: Totals row (sum of all teachers on this page)
  const handleExportAllTeachers = async () => {
    if (teachers.length === 0) {
      toast.error('لا يوجد معلمون للتصدير');
      return;
    }
    setExportingAll(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Sheet 1: Teachers list
      const headers = [
        'الاسم', 'البريد', 'الهاتف', 'الحالة',
        'المقررات', 'الطلاب',
        'الإيراد الكلي', 'المُسوّى', 'المتاح', 'تاريخ التسجيل',
      ];
      const rows = teachers.map((t) => [
        t.name, t.email, t.phone ?? '—', t.account_status,
        t.subject_count, t.student_count,
        Number(t.total_earned ?? 0).toFixed(2),
        Number(t.total_settled ?? 0).toFixed(2),
        Number(t.total_pending ?? 0).toFixed(2),
        new Date(t.created_at).toLocaleDateString('ar-EG'),
      ]);
      // Totals row
      const totalsRow = [
        'الإجمالي', '', '', '',
        teachers.reduce((s, t) => s + t.subject_count, 0),
        teachers.reduce((s, t) => s + t.student_count, 0),
        teachers.reduce((s, t) => s + Number(t.total_earned ?? 0), 0).toFixed(2),
        teachers.reduce((s, t) => s + Number(t.total_settled ?? 0), 0).toFixed(2),
        teachers.reduce((s, t) => s + Number(t.total_pending ?? 0), 0).toFixed(2),
        '',
      ];
      const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows, totalsRow]);
      ws1['!cols'] = [
        { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, ws1, `المعلمون (صفحة ${page})`);

      const fileName = `teachers_page${page}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`تم تصدير ${teachers.length} معلم إلى ${fileName}`);
    } catch (err) {
      console.error('[export-all-teachers] failed', err);
      toast.error('تعذّر تصدير قائمة المعلمين');
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <div className="space-y-6" dir={direction}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-sky-600" />
          {t('admin.teacherAccounts') || 'حسابات المعلمين'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('admin.teacherAccountsDesc') || 'إدارة حسابات المعلمين وعرض المعلومات المالية'}
        </p>
      </div>

      {/* Search bar + Export all + Bulk settle (G3) */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute h-4 w-4 text-muted-foreground ms-2 mt-2.5" />
          <Input
            type="text"
            placeholder={t('admin.searchTeachers') || 'بحث بالاسم أو البريد الإلكتروني...'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="ps-8 h-9"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={handleExportAllTeachers}
          disabled={exportingAll || teachers.length === 0}
          title="تصدير معلمي الصفحة الحالية إلى Excel"
        >
          {exportingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          تصدير الكل (Excel)
        </Button>
        {/* G3 — bulk settle */}
        <Button
          size="sm"
          variant="default"
          className="h-9 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={handleBulkSettle}
          disabled={bulkSettling || selectedTeacherIds.size === 0}
          title="تسوية المبالغ المتاحة لكل المعلمين المحددين"
        >
          {bulkSettling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <HandCoins className="h-4 w-4" />
          )}
          تسوية المحدد ({selectedTeacherIds.size})
        </Button>
        {/* Auto-payout bulk toggles */}
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1 border-sky-300 text-sky-700 hover:bg-sky-50"
          onClick={() => handleBulkToggleAutoPayout(true)}
          disabled={bulkToggling}
          title="تفعيل الدفع التلقائي عبر Paymob لكل المعلمين الذين لديهم مستحقات"
        >
          {bulkToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          تفعيل تلقائي للكل
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
          onClick={() => handleBulkToggleAutoPayout(false)}
          disabled={bulkToggling}
          title="تعطيل الدفع التلقائي لكل المعلمين الذين لديهم مستحقات (الرجوع للوضع اليدوي)"
        >
          تعطيل تلقائي للكل
        </Button>
      </div>

      {/* Teachers list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('admin.teachersList') || 'قائمة المعلمين'}</CardTitle>
          {pagination && (
            <CardDescription className="text-xs">
              {pagination.total_count} {t('admin.teachersTotal') || 'معلم'} • {t('common.page')} {page} {t('common.of')} {pagination.total_pages || 1}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-20 gap-4">
              <p className="text-sm text-rose-600">{error}</p>
              <Button onClick={fetchTeachers} variant="outline" size="sm">إعادة</Button>
            </div>
          ) : teachers.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3">
              <Users className="h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">{t('admin.noTeachers') || 'لا يوجد معلمون'}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr className="text-end">
                      <th className="p-3 text-center font-medium w-10">
                        {/* G3 — select-all checkbox */}
                        <input
                          type="checkbox"
                          aria-label="تحديد كل معلمي الصفحة"
                          checked={
                            teachers.length > 0 &&
                            teachers.every((t) => selectedTeacherIds.has(t.id))
                          }
                          onChange={toggleSelectAllOnPage}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer accent-emerald-600"
                        />
                      </th>
                      <th className="p-3 text-start font-medium">{t('common.name')}</th>
                      <th className="p-3 text-start font-medium">{t('common.email')}</th>
                      <th className="p-3 text-start font-medium">{t('common.status')}</th>
                      <th className="p-3 text-center font-medium">{t('subjects.subjects') || 'المقررات'}</th>
                      <th className="p-3 text-center font-medium">{t('admin.students') || 'الطلاب'}</th>
                      <th className="p-3 text-end font-medium text-emerald-600">مُسوّى</th>
                      <th className="p-3 text-end font-medium text-amber-600">متاح</th>
                      <th className="p-3 text-end font-medium">الإجمالي</th>
                      <th className="p-3 text-center font-medium text-sky-600">دفع تلقائي</th>
                      <th className="p-3 text-center font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((teacher) => (
                      <tr
                        key={teacher.id}
                        className={`border-b hover:bg-muted/20 cursor-pointer transition-colors ${selectedTeacherIds.has(teacher.id) ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}`}
                        onClick={() => fetchTeacherDetail(teacher.id)}
                      >
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {/* G3 — per-row checkbox */}
                          <input
                            type="checkbox"
                            aria-label={`تحديد ${teacher.name}`}
                            checked={selectedTeacherIds.has(teacher.id)}
                            onChange={() => toggleTeacherSelection(teacher.id)}
                            className="h-4 w-4 cursor-pointer accent-emerald-600"
                          />
                        </td>
                        <td className="p-3 text-start font-medium truncate max-w-[150px]">{teacher.name}</td>
                        <td className="p-3 text-start text-xs text-muted-foreground truncate max-w-[180px]">{teacher.email}</td>
                        <td className="p-3 text-center">
                          <Badge variant="secondary" className={
                            teacher.account_status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                            teacher.account_status === 'suspended' ? 'bg-rose-100 text-rose-700' :
                            'bg-amber-100 text-amber-700'
                          }>
                            {teacher.account_status}
                          </Badge>
                        </td>
                        <td className="p-3 text-center text-xs">{teacher.subject_count}</td>
                        <td className="p-3 text-center text-xs">{teacher.student_count}</td>
                        <td className="p-3 text-end font-mono text-xs text-emerald-600">
                          {Number(teacher.total_settled ?? 0).toFixed(2)}
                        </td>
                        <td className="p-3 text-end font-mono text-xs text-amber-600">
                          {Number(teacher.total_pending ?? teacher.total_revenue).toFixed(2)}
                        </td>
                        <td className="p-3 text-end font-mono text-xs font-bold">
                          {Number(teacher.total_earned ?? teacher.total_revenue).toFixed(2)}
                        </td>
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {/* Auto-payout per-teacher toggle */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={teacher.auto_payout_enabled}
                            aria-label={`تفعيل الدفع التلقائي لـ ${teacher.name}`}
                            disabled={togglingTeacherId === teacher.id}
                            onClick={() => toggleAutoPayout(teacher.id, teacher.auto_payout_enabled)}
                            title={
                              teacher.auto_payout_enabled
                                ? 'مفعّل — التسوية هتحول فلوس حقيقية عبر Paymob'
                                : 'معطّل — التسوية هتبقى تسجيل يدوي فقط'
                            }
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50 ${
                              teacher.auto_payout_enabled
                                ? 'bg-sky-600'
                                : 'bg-muted-foreground/30'
                            }`}
                          >
                            {togglingTeacherId === teacher.id ? (
                              <Loader2 className="h-3 w-3 animate-spin text-white absolute start-1.5" />
                            ) : (
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  teacher.auto_payout_enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                                }`}
                              />
                            )}
                          </button>
                          {autoPayoutWarnings[teacher.id] && (
                            <div className="text-[10px] text-amber-600 mt-1 max-w-[120px]">
                              ⚠️ يحتاج إعداد
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => fetchTeacherDetail(teacher.id)}
                            >
                              {t('common.view') || 'عرض'}
                            </Button>
                            {/* تسوية — settle (manual) */}
                            {Number(teacher.total_pending ?? 0) > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                disabled={settlingTeacherId === teacher.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSettle(teacher.id, Number(teacher.total_pending ?? 0));
                                }}
                                title="تسوية — تسجيل يدوي أن المعلم استلم"
                              >
                                {settlingTeacherId === teacher.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <HandCoins className="h-3 w-3" />
                                )}
                                تسوية
                              </Button>
                            )}
                            {/* سجل المعاملات */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-sky-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                fetchTransactions(teacher.id, teacher.name);
                              }}
                              title="سجل المعاملات"
                            >
                              <History className="h-3 w-3" />
                            </Button>
                            {/* تصدير Excel — per-teacher (N2) */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-emerald-700 hover:bg-emerald-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportTeacher(teacher);
                              }}
                              disabled={exportingTeacherId === teacher.id}
                              title="تصدير معاملات هذا المعلم إلى Excel"
                            >
                              {exportingTeacherId === teacher.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <Button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    variant="outline"
                    size="sm"
                    className="h-8"
                  >
                    {isRTL ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    <span className="hidden sm:inline ms-1">{t('common.previous') || 'السابق'}</span>
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t('common.page')} {page} {t('common.of')} {pagination.total_pages || 1}
                  </span>
                  <Button
                    onClick={() => setPage(Math.min(pagination.total_pages, page + 1))}
                    disabled={page >= pagination.total_pages}
                    variant="outline"
                    size="sm"
                    className="h-8"
                  >
                    <span className="hidden sm:inline me-1">{t('common.next') || 'التالي'}</span>
                    {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Teacher Detail Modal */}
      <AnimatePresence>
        {selectedTeacherId && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !detailLoading && setSelectedTeacherId(null)} />
            <motion.div
              className="relative bg-background rounded-2xl shadow-xl border max-w-2xl w-full max-h-[85vh] overflow-y-auto"
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              dir={direction}
            >
              {detailLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
                </div>
              ) : teacherDetail ? (
                <div className="p-6 space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-bold">
                        {(teacherDetail.teacher?.name ?? '?').charAt(0)}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold">{teacherDetail.teacher?.name ?? '—'}</h2>
                        <p className="text-xs text-muted-foreground">{teacherDetail.teacher?.email ?? '—'}</p>
                      </div>
                    </div>
                    <button onClick={() => setSelectedTeacherId(null)} className="rounded-full p-2 hover:bg-muted">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Account info */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">{t('common.phone') || 'الهاتف'}</span>
                      <p className="font-medium">{teacherDetail.teacher?.phone || '—'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">{t('common.status') || 'الحالة'}</span>
                      <Badge variant="secondary" className="mt-0.5">{teacherDetail.teacher?.account_status ?? '—'}</Badge>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">{t('subjects.subjects') || 'المقررات'}</span>
                      <p className="font-medium">{teacherDetail.teacher?.subject_count ?? 0}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">{t('admin.students') || 'الطلاب'}</span>
                      <p className="font-medium">{teacherDetail.teacher?.student_count ?? 0}</p>
                    </div>
                  </div>

                  {/* Financial summary */}
                  <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                      {t('admin.financialSummary') || 'الملخص المالي'}
                    </h3>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">{t('admin.totalRevenue') || 'الإيراد'}</p>
                        <p className="text-lg font-bold font-mono text-emerald-700">
                          {Number(teacherDetail.financial_summary?.total_revenue ?? 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t('admin.settled') || 'مُسوّى'}</p>
                        <p className="text-lg font-bold font-mono text-sky-700">
                          {Number(teacherDetail.financial_summary?.total_settled ?? 0).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{t('admin.pending') || 'معلّق'}</p>
                        <p className="text-lg font-bold font-mono text-amber-700">
                          {Number(teacherDetail.financial_summary?.total_pending ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground text-center pt-1">
                      {teacherDetail.financial_summary?.transaction_count ?? 0} {t('admin.transactions') || 'معاملة'}
                    </div>
                  </div>

                  {/* Payout methods (masked by default + "show details" for admin) */}
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-sky-600" />
                        {t('admin.payoutMethods') || 'طرق الاستلام'}
                      </h3>
                      {(teacherDetail.payout_methods ?? []).length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={async () => {
                            // Toggle: if already showing full details, hide them (revert to masked)
                            if (teacherDetail.show_full_details) {
                              setTeacherDetail((prev: Record<string, unknown> | null) => ({
                                ...prev,
                                show_full_details: false,
                                payout_methods: (prev as { payout_methods?: unknown[] })?.payout_methods?.map((pm: any) => ({
                                  ...pm,
                                  details: null, // clear full details → show masked again
                                })),
                              }));
                              return;
                            }
                            // Otherwise fetch + show full details
                            try {
                              const res = await fetch(`/api/admin/teachers/${selectedTeacherId}/payout-details`, { headers: await getCachedAuthHeaders() });
                              const json = await res.json();
                              if (json.success) {
                                setTeacherDetail((prev: Record<string, unknown> | null) => ({ ...prev, payout_methods: json.payout_methods, show_full_details: true }));
                              } else {
                                toast.error(json.error || 'Failed');
                              }
                            } catch (e) { toast.error('Failed'); }
                          }}
                        >
                          {teacherDetail.show_full_details ? (
                            <><EyeOff className="h-3 w-3 me-1" />إخفاء التفاصيل</>
                          ) : (
                            <><Eye className="h-3 w-3 me-1" />{t('admin.showTransferDetails') || 'عرض تفاصيل التحويل'}</>
                          )}
                        </Button>
                      )}
                    </div>
                    {(teacherDetail.payout_methods ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">{t('admin.noPayoutMethods') || 'لا توجد طرق استلام مُسجّلة'}</p>
                    ) : (
                      <div className="space-y-2">
                        {(teacherDetail.payout_methods ?? []).map((pm: any) => (
                          <div key={pm.id} className="flex items-start justify-between text-sm border-b pb-2">
                            <div className="min-w-0 flex-1">
                              <span className="font-medium">{pm.display_label}</span>
                              <span className="text-xs text-muted-foreground ms-2">({pm.method_type})</span>
                              {/* Show masked by default, full details when admin clicks "show details" */}
                              {pm.details ? (
                                <div className="text-xs space-y-1 mt-1 bg-muted/30 rounded p-2">
                                  {Object.entries(pm.details)
                                    .filter(([k]) => k !== 'method_type')
                                    .map(([key, val]) => (
                                      <div key={key} className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">{FIELD_LABELS_AR[key] ?? key}:</span>
                                        <span className="font-semibold break-all text-end" dir="ltr">{String(val)}</span>
                                      </div>
                                    ))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground font-mono">{pm.details_masked ?? '—'}</div>
                              )}
                              {pm.details_error && (
                                <div className="text-xs text-rose-600 mt-1">⚠️ {pm.details_error}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {pm.is_default && <Badge variant="secondary" className="text-xs">{t('admin.default') || 'افتراضي'}</Badge>}
                              <Badge variant={pm.is_active ? 'secondary' : 'outline'} className="text-xs">
                                {pm.is_active ? (t('common.active') || 'نشط') : (t('common.inactive') || 'غير نشط')}
                              </Badge>
                              {pm.verified_at && (
                                <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3 me-1" /> {t('admin.verified') || 'مُوثّق'}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recent transactions */}
                  <div className="rounded-lg border p-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-600" />
                      {t('admin.recentTransactions') || 'آخر المعاملات'}
                    </h3>
                    {(teacherDetail.recent_transactions ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">{t('admin.noTransactions') || 'لا توجد معاملات'}</p>
                    ) : (
                      <div className="space-y-1">
                        {(teacherDetail.recent_transactions ?? []).map((tx: any) => (
                          <div key={tx.id} className="flex items-center justify-between text-xs border-b py-1">
                            <div className="min-w-0 flex-1">
                              <span className="font-mono">{new Date(tx.created_at).toLocaleDateString('ar-EG')}</span>
                              <span className="text-muted-foreground ms-2">{tx.currency}</span>
                            </div>
                            <div className="text-end shrink-0">
                              <span className="font-mono font-semibold text-emerald-700">
                                +{Number(tx.teacher_share).toFixed(2)}
                              </span>
                              <Badge variant="secondary" className="text-xs ms-2">{tx.status}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Transactions Log Modal ─── */}
      <AnimatePresence>
        {transactionsModal.open && transactionsModal.teacherId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setTransactionsModal({ open: false, teacherId: null, teacherName: null })}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border bg-background shadow-xl"
              dir={direction}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b p-5">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <History className="h-5 w-5 text-sky-600" />
                  سجل المعاملات
                  {transactionsModal.teacherName && (
                    <span className="text-sm text-muted-foreground">— {transactionsModal.teacherName}</span>
                  )}
                </h3>
                <button
                  onClick={() => setTransactionsModal({ open: false, teacherId: null, teacherName: null })}
                  className="h-8 w-8 rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5">
                {transactionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <History className="h-12 w-12 text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد معاملات لهذا المعلم.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transactions.map((tx: any) => (
                      <div key={tx.id} className="rounded-lg border p-3 space-y-2">
                        {/* Row 1: code + status + amount */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(tx.transaction_code);
                              toast.success(`تم نسخ الكود: ${tx.transaction_code}`);
                            }}
                            className="text-xs font-mono text-sky-700 dark:text-sky-300 hover:underline inline-flex items-center gap-1"
                          >
                            <span className="bg-sky-50 dark:bg-sky-900/20 px-1.5 py-0.5 rounded">
                              {tx.transaction_code}
                            </span>
                            <Copy className="h-2.5 w-2.5" />
                          </button>
                          <Badge variant={tx.status === 'completed' ? 'default' : 'secondary'} className="text-xs">
                            {tx.status_label}
                          </Badge>
                          <span className="text-sm font-mono font-bold">
                            {Number(tx.amount).toFixed(2)} {tx.currency}
                          </span>
                        </div>
                        {/* Row 2: method + dates */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Wallet className="h-3 w-3" />
                            {tx.method_label} ({tx.method_masked})
                          </span>
                          <span>أُنشئ: {new Date(tx.created_at).toLocaleString('ar-EG')}</span>
                          {tx.executed_at && (
                            <span className="text-emerald-600">
                              نُفّذ: {new Date(tx.executed_at).toLocaleString('ar-EG')}
                            </span>
                          )}
                        </div>
                        {/* Linked entries */}
                        {tx.linked_entries && tx.linked_entries.length > 0 && (
                          <div className="text-xs text-muted-foreground border-t pt-2">
                            <span className="font-medium">العمليات المرتبطة ({tx.linked_entries.length}):</span>
                            <div className="mt-1 space-y-0.5">
                              {tx.linked_entries.map((le: any, i: number) => (
                                <div key={i} className="flex justify-between">
                                  <span className="font-mono">{le.order_id?.slice(0, 8)}...</span>
                                  <span className="font-mono">{Number(le.amount_settled).toFixed(2)} {le.currency}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Failure reason */}
                        {tx.failure_reason && (
                          <div className="text-xs text-rose-600">{tx.failure_reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
