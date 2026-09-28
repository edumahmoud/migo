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
} from 'lucide-react';
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
  subject_count: number;
  student_count: number;
  total_revenue: number;
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

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute h-4 w-4 text-muted-foreground ms-2 mt-2.5" />
          <Input
            type="text"
            placeholder={t('admin.searchTeachers') || 'بحث بالاسم أو البريد الإلكتروني...'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="ps-8 h-9"
          />
        </div>
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
                      <th className="p-3 text-start font-medium">{t('common.name')}</th>
                      <th className="p-3 text-start font-medium">{t('common.email')}</th>
                      <th className="p-3 text-start font-medium">{t('common.status')}</th>
                      <th className="p-3 text-center font-medium">{t('subjects.subjects') || 'المقررات'}</th>
                      <th className="p-3 text-center font-medium">{t('admin.students') || 'الطلاب'}</th>
                      <th className="p-3 text-end font-medium">{t('admin.totalRevenue') || 'الإيراد'}</th>
                      <th className="p-3 text-center font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((teacher) => (
                      <tr
                        key={teacher.id}
                        className="border-b hover:bg-muted/20 cursor-pointer transition-colors"
                        onClick={() => fetchTeacherDetail(teacher.id)}
                      >
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
                        <td className="p-3 text-end font-mono text-xs font-semibold text-emerald-700">
                          {Number(teacher.total_revenue).toFixed(2)} EGP
                        </td>
                        <td className="p-3 text-center">
                          <Button size="sm" variant="ghost" className="h-7 text-xs">
                            {t('common.view') || 'عرض'}
                          </Button>
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
                                <div className="text-xs font-mono space-y-0.5 mt-1 bg-muted/30 rounded p-2">
                                  {Object.entries(pm.details)
                                    .filter(([k]) => k !== 'method_type')
                                    .map(([key, val]) => (
                                      <div key={key} className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">{key}:</span>
                                        <span className="font-semibold break-all text-end">{String(val)}</span>
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
    </div>
  );
}
