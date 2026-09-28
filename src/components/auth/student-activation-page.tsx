'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Loader2, KeyRound, Copy, Link as LinkIcon, BookOpen, CreditCard,
  CheckCircle2, AlertCircle, RefreshCw, LogOut, Check, X,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import { supabase } from '@/lib/supabase';
import {
  PaymentSummaryDialog,
  type PaymentSummaryOrder,
} from '@/components/student/payment-summary-dialog';
import {
  createCheckoutSession,
  PaymentActionError,
  getPaymentActionErrorMessage,
  type CheckoutSessionItem,
} from '@/lib/student/payment-action';

interface AvailableCourse {
  id: string; name: string; description: string | null;
  level: string | null; sub_level: string | null;
  price: number; currency: string; teacher_name: string | null;
}
interface OrderRow {
  id: string; subject_id: string; amount: number; currency: string;
  provider: string; status: string;
  created_at: string; paid_at: string | null;
  checkout_session_id?: string | null;
}
interface Subscription {
  subject_id: string; status: string; enrollment_method: string;
  current_period_start: string | null; current_period_end: string | null;
  next_billing_at: string | null; monthly_price: number | null; enrolled_at: string;
}
interface ActivationData {
  student: { id: string; email: string; name: string | null; student_code: string | null; account_status: string };
  linked_teachers: Array<{ teacher: { id: string; name: string | null; email: string; teacher_code: string } | null; status: string }>;
  available_courses: AvailableCourse[];
  recent_orders: OrderRow[];
  subscriptions: Subscription[];
}


export default function StudentActivationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut, user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [data, setData] = useState<ActivationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [silentRefreshing, setSilentRefreshing] = useState(false);
  const [teacherCode, setTeacherCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // ─── Payment Summary dialog state ───
  // For "continue payment on existing pending order" flow.
  // When a student clicks "Complete Payment" on a pending order in
  // the "قيد الدفع" list, we open the SAME Payment Summary dialog used
  // by the new-order flow — no new order is created, the existing
  // order's ID is passed to /api/student/orders/[id]/pay.
  //
  // Phase 14.1 (multi-subject): also supports a CONSOLIDATED view of
  // multiple pending orders grouped into one checkout session. The
  // student can click "Complete Payment for All" to pay them all in
  // one Paymob Intention.
  const [paymentSummaryOrder, setPaymentSummaryOrder] = useState<PaymentSummaryOrder | null>(null);
  const [paymentSummaryOpen, setPaymentSummaryOpen] = useState(false);
  const [sessionItems, setSessionItems] = useState<CheckoutSessionItem[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const studentId = user?.id;

  // Silent reload — updates data WITHOUT showing the full-page loading spinner.
  // Used by realtime events and action callbacks (link teacher, create order).
  const silentReload = useCallback(async () => {
    setSilentRefreshing(true);
    try {
      const res = await fetch('/api/student/activation/me', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setData(json as ActivationData);
        if ((json as ActivationData).student.account_status === 'active') {
          toast.success('تم تفعيل حسابك! جارٍ فتح المنصة...');
          setTimeout(() => router.push('/'), 1500);
        }
      }
    } catch {
      // Silent — don't show error toast on background refreshes
    } finally {
      setSilentRefreshing(false);
    }
  }, [router]);

  // Initial load — shows the full-page spinner (only on first mount).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/student/activation/me', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setData(json as ActivationData);
        if ((json as ActivationData).student.account_status === 'active') {
          toast.success('تم تفعيل حسابك! جارٍ فتح المنصة...');
          setTimeout(() => router.push('/'), 1500);
        }
      } else toast.error(json.error || t('common.unexpectedError'));
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setLoading(false); }
  }, [t, router]);

  // Initial load only — no polling.
  useEffect(() => { load(); }, [load]);

  // ─── Realtime subscriptions (replaces polling) ───
  // Fires ONLY when actual DB changes happen — no interval, no page refresh.
  // Uses silentReload (no full-page spinner) so the update is instant.
  useEffect(() => {
    if (!studentId) return;

    const channel = supabase
      .channel('activation-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `student_id=eq.${studentId}` },
        () => { silentReload(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subject_students', filter: `student_id=eq.${studentId}` },
        () => { silentReload(); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${studentId}` },
        () => { silentReload(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId, silentReload]);

  const handleLinkTeacher = async () => {
    if (!teacherCode.trim()) { toast.error('أدخل كود المعلم'); return; }
    setLinking(true);
    try {
      const res = await fetch('/api/student/activation/link-teacher', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ teacherCode: teacherCode.trim() }),
      });
      const json = await res.json();
      if (json.success) { toast.success(`تم الربط بـ ${json.teacher?.name ?? 'المعلم'}`); setTeacherCode(''); await silentReload(); }
      else toast.error(json.error || t('common.unexpectedError'));
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setLinking(false); }
  };

  const toggleCourse = (id: string) => {
    setSelectedCourses(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSubmitOrders = async () => {
    if (selectedCourses.size === 0) { toast.error('اختر مقرراً واحداً على الأقل'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/student/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ subjectIds: Array.from(selectedCourses) }),
      });
      const json = await res.json();
      if (json.success) {
        setSelectedCourses(new Set());
        await silentReload();

        // ─── Phase 14.1: multi-subject checkout ───
        // After creating the pending orders, identify which were paid
        // courses (status='pending'). If there are MULTIPLE paid orders,
        // open a consolidated Payment Summary dialog with all of them.
        // If there's exactly ONE paid order, open the single-order dialog
        // (Phase 14.0 backward compat). If there are ZERO paid orders
        // (all free), just show the success toast.
        const createdOrders: Array<{
          id?: string; subject_id?: string; amount?: number | string;
          currency?: string; status?: string; subject_name?: string;
          free?: boolean; error?: string;
        }> = Array.isArray(json.created_orders) ? json.created_orders : [];

        const paidOrders = createdOrders.filter(
          (o) => o.status === 'pending' && !o.free && Number(o.amount ?? 0) > 0,
        );

        if (paidOrders.length === 0) {
          // All free courses — show the existing success toast
          toast.success(json.message || 'تم إنشاء الطلبات');
        } else if (paidOrders.length === 1) {
          // Single paid order — open the single-order Payment Summary
          const o = paidOrders[0];
          setPaymentSummaryOrder({
            orderId: String(o.id),
            subjectName: String(o.subject_name ?? '—'),
            amount: Number(o.amount),
            currency: String(o.currency ?? 'EGP'),
          });
          setPaymentSummaryOpen(true);
        } else {
          // Multiple paid orders — create a checkout session, then open
          // the consolidated Payment Summary dialog.
          const orderIds = paidOrders.map((o) => String(o.id));
          try {
            const session = await createCheckoutSession(orderIds, await getCachedAuthHeaders());
            setPaymentSummaryOrder(null); // single-order mode disabled
            setSessionItems(session.items);
            setSessionId(session.session_id);
            setPaymentSummaryOpen(true);
            toast.info(
              t('student.payment.paymentSummaryDesc') +
              ` — ${session.item_count} ${t('student.payment.coursesLabel')} • ${session.total_amount.toFixed(2)} ${session.currency}`,
            );
          } catch (err) {
            // Session creation failed — show categorized error
            const message = err instanceof PaymentActionError
              ? getPaymentActionErrorMessage(err, t('student.payment.paymentInitFailed'))
              : (err instanceof Error ? err.message : t('student.payment.paymentInitFailed'));
            toast.error(message);
            // Fall back to showing the success toast (orders were created,
            // the student can pay them individually from the pending list)
            toast.success(json.message || 'تم إنشاء الطلبات');
          }
        }
      } else toast.error(json.error || t('common.unexpectedError'));
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setSubmitting(false); }
  };

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`تم نسخ ${label}`); }
    catch { toast.error('تعذّر النسخ'); }
  };

  const handleSignOut = () => { resetAppStore(); try { signOut(); } catch {} router.push('/'); };

  const courseNameById = useMemo(() => {
    const m = new Map<string, string>();
    if (data) data.available_courses.forEach(c => m.set(c.id, c.name));
    return m;
  }, [data]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-teal-50">
        <div className="flex items-center gap-2 text-sky-700">
          <Loader2 className="h-5 w-5 animate-spin" /><span>جارٍ تحميل صفحة التفعيل...</span>
        </div>
      </div>
    );
  }

  const studentCode = data.student.student_code ?? '—';
  const linkedTeachers = data.linked_teachers;
  const pendingOrders = data.recent_orders.filter(o => o.status === 'pending');
  // Phase 14: Split pending orders into session-grouped + standalone.
  // Orders WITH a checkout_session_id should NOT show individual "استكمال الدفع"
  // buttons — they should be paid via the grouped "Complete Payment for All"
  // button (which uses the existing session_id).
  const sessionPendingOrders = pendingOrders.filter(o => o.checkout_session_id);
  const standalonePendingOrders = pendingOrders.filter(o => !o.checkout_session_id);
  // Group session orders by their checkout_session_id
  const sessionGroups = new Map<string, OrderRow[]>();
  for (const o of sessionPendingOrders) {
    const sid = o.checkout_session_id as string;
    if (!sessionGroups.has(sid)) sessionGroups.set(sid, []);
    sessionGroups.get(sid)!.push(o);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50 p-3 sm:p-6">
      {/* Subtle refresh indicator — shows a thin bar when silently refreshing */}
      {silentRefreshing && (
        <div className="fixed top-0 left-0 right-0 h-0.5 bg-sky-500 z-50 animate-pulse" />
      )}
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">تفعيل الحساب</h1>
              <p className="text-sm text-muted-foreground">{data.student.name ?? data.student.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 me-1" />تسجيل الخروج
          </Button>
        </motion.div>

        {/* Pending notice */}
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold mb-1">حسابك قيد التفعيل</p>
              <p className="text-xs">اربط نفسك بمعلم ← اختر مقررات ← حول رسومها ← سيقوم المركز بتفعيل اشتراكك بعد إثبات الدفع.</p>
            </div>
          </CardContent>
        </Card>

        {/* Student Code */}
        <Card className="border-sky-200 bg-sky-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4 text-sky-600" />كود الطالب</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-2xl tracking-widest bg-white border border-sky-200 px-3 py-2 rounded text-center">{studentCode}</code>
              <Button size="icon" variant="outline" onClick={() => copy(studentCode, 'كود الطالب')} title="نسخ"><Copy className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>

        {/* Teacher linking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><LinkIcon className="h-4 w-4 text-sky-600" />الربط مع المعلم</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={teacherCode} onChange={e => setTeacherCode(e.target.value.toUpperCase())} placeholder="مثال: A1B2C3" dir="ltr" maxLength={40} className="font-mono tracking-widest" disabled={linking} />
              <Button onClick={handleLinkTeacher} disabled={linking || !teacherCode.trim()}>
                {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}ربط
              </Button>
            </div>
            {linkedTeachers.length > 0 && (
              <div className="space-y-1">
                {linkedTeachers.map((lt, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="font-medium">{lt.teacher?.name ?? '—'}</span>
                    <Badge variant="outline" className="text-xs" dir="ltr">{lt.teacher?.email}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Available courses — multi-select */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4 text-sky-600" />المقررات المتاحة</CardTitle>
              <CardDescription className="text-xs">الاشتراك شهري — اختر المقررات ثم اضغط متابعة الدفع.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={load} title="تحديث"><RefreshCw className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {linkedTeachers.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">اربط نفسك بمعلم أولاً لرؤية المقررات المتاحة.</div>
            ) : data.available_courses.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">لا توجد مقررات متاحة للاشتراك حالياً.</div>
            ) : (
              <>
                {data.available_courses.map(c => {
                  const sub = data.subscriptions?.find(s => s.subject_id === c.id);
                  const isSubActive = sub?.current_period_end && new Date(sub.current_period_end) > new Date();
                  const isSelected = selectedCourses.has(c.id);
                  return (
                    <div key={c.id} className={`flex items-center gap-3 border rounded-md p-3 cursor-pointer transition-colors ${isSelected ? 'border-sky-400 bg-sky-50/40' : 'hover:bg-muted/30'}`}
                      onClick={() => toggleCourse(c.id)}>
                      <div className={`flex h-5 w-5 items-center justify-center rounded border shrink-0 ${isSelected ? 'bg-sky-600 border-sky-600 text-white' : 'border-muted-foreground/40'}`}>
                        {isSelected && <Check className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                          {c.teacher_name && <span>· {c.teacher_name}</span>}
                          {(c.level || c.sub_level) && <span>· {[c.level, c.sub_level].filter(Boolean).join(' / ')}</span>}
                          {isSubActive && sub?.current_period_end && (
                            <Badge variant="default" className="text-[10px] bg-emerald-600">نشط حتى {new Date(sub.current_period_end).toLocaleDateString('ar-EG')}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-end shrink-0 font-bold text-emerald-700">
                        {c.price === 0 ? 'مجاناً' : `${Number(c.price).toFixed(2)} ${c.currency}/شهر`}
                      </div>
                    </div>
                  );
                })}
                <Button onClick={handleSubmitOrders} disabled={submitting || selectedCourses.size === 0} className="w-full h-11 bg-gradient-to-l from-sky-700 to-teal-600">
                  {submitting ? <Loader2 className="h-5 w-5 animate-spin me-2" /> : <CreditCard className="h-5 w-5 me-2" />}
                  متابعة الدفع ({selectedCourses.size} مقرر)
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Pending orders — "قيد الدفع" list */}
        {pendingOrders.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-amber-600" />المقررات قيد الدفع</CardTitle>
              <CardDescription className="text-xs">بانتظار تفعيل المركز بعد إثبات الدفع.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {/* ─── Phase 14: Session-grouped pending orders ─── */}
              {/* Orders WITH a checkout_session_id are part of a multi-subject
                  checkout session. They show a SINGLE "Complete Payment for All"
                  button (using the EXISTING session_id) and do NOT show
                  individual "استكمال الدفع" buttons — preventing duplicate
                  payment paths. */}
              {Array.from(sessionGroups.entries()).map(([sessionId, orders]) => {
                if (orders.length === 0) return null;
                const sameCurrency = new Set(orders.map((o) => o.currency)).size === 1;
                if (!sameCurrency) return null;
                const total = orders.reduce((sum, o) => sum + Number(o.amount), 0);
                const currency = orders[0].currency;
                return (
                  <div key={sessionId} className="mb-2 rounded-md border border-teal-200 dark:border-teal-900/40 bg-teal-50 dark:bg-teal-900/15 p-3 space-y-2">
                    <div className="text-sm font-medium text-teal-800 dark:text-teal-200">
                      {t('student.payment.pendingGroupTitle', { count: orders.length })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('student.payment.pendingGroupDesc')}
                    </div>
                    {/* Items preview (course names) */}
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {orders.map((o) => (
                        <div key={o.id} className="truncate">
                          • {courseNameById.get(o.subject_id) ?? '—'}
                        </div>
                      ))}
                    </div>
                    {/* Total + Pay All button (uses EXISTING session_id) */}
                    <div className="flex items-center justify-between pt-1 border-t border-teal-200 dark:border-teal-900/40">
                      <div className="text-sm">
                        <span className="text-muted-foreground">{t('student.payment.total')}: </span>
                        <span className="font-bold text-teal-700 dark:text-teal-300 font-mono">
                          {total.toFixed(2)} {currency}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                        onClick={async () => {
                          // Use the EXISTING session_id (don't create a new one)
                          // + fetch the session items to display in the dialog.
                          try {
                            // Build the items from the existing pending orders
                            // (all values are server-authoritative from the DB).
                            const items = orders.map((o) => ({
                              order_id: o.id,
                              subject_id: o.subject_id,
                              subject_name: courseNameById.get(o.subject_id) ?? '—',
                              amount: Number(o.amount),
                              currency: String(o.currency ?? 'EGP'),
                            }));
                            setPaymentSummaryOrder(null);
                            setSessionItems(items);
                            setSessionId(sessionId);
                            setPaymentSummaryOpen(true);
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : t('student.payment.paymentInitFailed'));
                          }
                        }}
                      >
                        <CreditCard className="h-3 w-3 me-1" />
                        {t('student.payment.completePaymentGroup')}
                      </Button>
                    </div>
                  </div>
                );
              })}

              {/* ─── Phase 14: Standalone pending orders (NOT in a session) ─── */}
              {/* Orders WITHOUT a checkout_session_id can be paid individually
                  via "استكمال الدفع" OR grouped if there are 2+ in the same
                  currency (the "Complete Payment for All" button creates a
                  NEW session for them). */}
              {standalonePendingOrders.length >= 2 && (() => {
                const sameCurrency = new Set(standalonePendingOrders.map((o) => o.currency)).size === 1;
                if (!sameCurrency) return null;
                const total = standalonePendingOrders.reduce((sum, o) => sum + Number(o.amount), 0);
                const currency = standalonePendingOrders[0].currency;
                return (
                  <div className="mb-2 rounded-md border border-sky-200 dark:border-sky-900/40 bg-sky-50 dark:bg-sky-900/15 p-3 space-y-2">
                    <div className="text-sm font-medium text-sky-800 dark:text-sky-200">
                      {t('student.payment.pendingGroupTitle', { count: standalonePendingOrders.length })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('student.payment.pendingGroupDesc')}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {standalonePendingOrders.map((o) => (
                        <div key={o.id} className="truncate">
                          • {courseNameById.get(o.subject_id) ?? '—'}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-sky-200 dark:border-sky-900/40">
                      <div className="text-sm">
                        <span className="text-muted-foreground">{t('student.payment.total')}: </span>
                        <span className="font-bold text-sky-700 dark:text-sky-300 font-mono">
                          {total.toFixed(2)} {currency}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                        onClick={async () => {
                          const orderIds = standalonePendingOrders.map((o) => o.id);
                          try {
                            const session = await createCheckoutSession(orderIds, await getCachedAuthHeaders());
                            setPaymentSummaryOrder(null);
                            setSessionItems(session.items);
                            setSessionId(session.session_id);
                            setPaymentSummaryOpen(true);
                          } catch (err) {
                            const message = err instanceof PaymentActionError
                              ? getPaymentActionErrorMessage(err, t('student.payment.paymentInitFailed'))
                              : (err instanceof Error ? err.message : t('student.payment.paymentInitFailed'));
                            toast.error(message);
                          }
                        }}
                      >
                        <CreditCard className="h-3 w-3 me-1" />
                        {t('student.payment.completePaymentGroup')}
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* Standalone pending orders — individual "استكمال الدفع" buttons */}
              {/* (ONLY for orders NOT in a session — session orders are
                  covered by the grouped button above) */}
              {standalonePendingOrders.map(o => (
                <div key={o.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{courseNameById.get(o.subject_id) ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString('ar-EG')}</div>
                  </div>
                  <div className="text-end shrink-0 flex items-center gap-2">
                    <span className="font-mono text-xs">{Number(o.amount).toFixed(2)} {o.currency}</span>
                    <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 me-1" />قيد الدفع</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setPaymentSummaryOrder({
                          orderId: o.id,
                          subjectName: courseNameById.get(o.subject_id) ?? '—',
                          amount: Number(o.amount),
                          currency: String(o.currency ?? 'EGP'),
                        });
                        setSessionItems(null);
                        setSessionId(null);
                        setPaymentSummaryOpen(true);
                      }}
                    >
                      <CreditCard className="h-3 w-3 me-1" />
                      {t('student.payment.completePayment')}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── Payment Summary Dialog (existing pending order continuation OR consolidated) ─── */}
      {/* Rendered here so it overlays above the activation page content
          when opened. Uses the same dialog + same /pay endpoint as the
          new-order flow in subjects-section.tsx.
          - Single-order mode: `order` is set (one pending order from
            the "استكمال الدفع" button next to each pending order).
          - Multi-subject mode: `sessionItems` + `sessionId` are set
            (created via createCheckoutSession when the student clicks
            "Complete Payment for All" on a group of pending orders). */}
      <PaymentSummaryDialog
        open={paymentSummaryOpen}
        onOpenChange={setPaymentSummaryOpen}
        order={paymentSummaryOrder}
        sessionItems={sessionItems}
        sessionId={sessionId}
        onSessionItemsChange={(updatedItems) => {
          setSessionItems(updatedItems);
          if (updatedItems.length === 0) {
            setSessionId(null);
            setPaymentSummaryOpen(false);
          }
        }}
      />

    </div>
  );
}
