'use client';

/**
 * Agent Portal — v114
 *
 * Sections (sidebar-controlled):
 *   1. search      — search student by code → details + pending orders + subscriptions
 *   2. pending     — all pending orders for this agent's teacher
 *   3. students    — quick student search
 *   4. settings    — agent profile + Teacher View (filtered by allowed_sections)
 *
 * v114 changes:
 *   - Settings section now exposes a "Teacher View" sub-view that lets the
 *     agent navigate the teacher's own dashboard sections (subjects,
 *     summaries, students, tracking, financialManagement, pendingOrders,
 *     chat, etc.). Visible sections are filtered by the per-agent
 *     allowed_sections config (NULL = all allowed).
 *   - All 4 base sections (search/pending/students/settings) remain
 *     ALWAYS accessible to active agents — the teacher can only restrict
 *     access to the TEACHER's sections shown in the profile's Teacher View.
 *
 * No duplicate sections. No SUB-XXXX references. No PaymentCodeSearchBox.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Ban, BadgeCheck, Clock, RefreshCw, Search, Users,
  Settings, Inbox, BookOpen, ShieldCheck,
  LayoutDashboard, FileText, Database, DollarSign, MessageCircle,
  Activity, Video, FolderOpen, ListTodo, Calendar as CalendarIcon,
  ShieldAlert, TrendingUp, Bell, Package, UserCog, ChevronRight, ChevronDown,
  AlertCircle, Gift, Tag, PauseCircle, XCircle, ArrowRight, CheckCircle2,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslations } from '@/i18n/use-translations';
import AgentStudentSuspendDialog from '@/components/agent/agent-student-suspend-dialog';

// ─── Types ───
interface StudentResult {
  student: {
    id: string; email: string; name: string | null; username: string | null;
    student_code: string | null; account_status: string | null; created_at: string;
  };
  subscriptions: Array<{
    id: string; subject_id: string; status: string;
    current_period_end: string | null;
    subject: { id: string; name: string } | null;
  }>;
  pending_orders: Array<{
    id: string; subject_id: string; amount: number; currency: string;
    status: string; created_at: string; provider_order_ref: string | null;
    // v121: add v88 fees-on-top fields
    base_amount?: number | null;
    fees_total?: number | null;
    grand_total?: number | null;
    // v123: add checkout_session_id
    checkout_session_id?: string | null;
    // v126: add plan_duration_days
    plan_duration_days?: number | null;
    subject: { id: string; name: string; price?: number } | null;
  }>;
}

interface PendingOrder {
  id: string; subject_id: string; amount: number; currency: string;
  status: string; created_at: string; provider_order_ref: string | null;
  // v121: add v88 fees-on-top fields (returned by /api/agent/orders since v117)
  base_amount?: number | null;
  fees_total?: number | null;
  grand_total?: number | null;
  // v123: add checkout_session_id for multi-checkout session detection
  checkout_session_id?: string | null;
  // v126: add plan_duration_days for free plan duration display
  plan_duration_days?: number | null;
  student: { id: string; name: string | null; email: string; student_code: string | null } | null;
  subject: { id: string; name: string; price?: number } | null;
}

interface AgentSelf {
  id: string;
  display_name: string | null;
  kind: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source_id: string | null;
  allowed_sections: string[] | null;
}

interface TeacherInfo {
  id: string;
  name: string | null;
  email: string | null;
  // v130: ban status — used to show suspended-teacher modal
  is_banned?: boolean;
  ban_reason?: string | null;
}

// Teacher sections the agent may browse from their profile.
// Order matters — this is the order they'll appear in the Teacher View nav.
const TEACHER_SECTION_DEFS: Array<{
  id: string;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'dashboard',           label: 'الرئيسية',        icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: 'subjects',             label: 'المقررات',       icon: <BookOpen className="h-5 w-5" /> },
  { id: 'students',             label: 'الطلاب',         icon: <Users className="h-5 w-5" /> },
  { id: 'tracking',             label: 'التتبع',         icon: <Activity className="h-5 w-5" /> },
  { id: 'summaries',            label: 'الملخصات',       icon: <FileText className="h-5 w-5" /> },
  { id: 'questionBank',        label: 'بنك الأسئلة',   icon: <Database className="h-5 w-5" /> },
  { id: 'scormLibrary',         label: 'مكتبة SCORM',    icon: <Package className="h-5 w-5" /> },
  { id: 'pendingOrders',        label: 'طلبات معلّقة',   icon: <Clock className="h-5 w-5" /> },
  { id: 'financialManagement',  label: 'الإدارة المالية', icon: <DollarSign className="h-5 w-5" /> },
  { id: 'chat',                 label: 'المحادثة',       icon: <MessageCircle className="h-5 w-5" /> },
  { id: 'videos',               label: 'الفيديوهات',     icon: <Video className="h-5 w-5" /> },
  { id: 'files',                label: 'الملفات',        icon: <FolderOpen className="h-5 w-5" /> },
  { id: 'todos',                label: 'المهام',         icon: <ListTodo className="h-5 w-5" /> },
  { id: 'calendar',             label: 'التقويم',        icon: <CalendarIcon className="h-5 w-5" /> },
  { id: 'reports',              label: 'البلاغات',       icon: <ShieldAlert className="h-5 w-5" /> },
  { id: 'analytics',            label: 'التحليلات',      icon: <TrendingUp className="h-5 w-5" /> },
  { id: 'notifications',        label: 'الإشعارات',      icon: <Bell className="h-5 w-5" /> },
  { id: 'registration',         label: 'وكلاء التسجيل',   icon: <UserCog className="h-5 w-5" /> },
];

// v116 fix: the actual sidebar items are now search/pending/teacherView/profile.
// 'students' + 'settings' were removed in the v116 restructure but the type
// wasn't updated. The 'profile' section is handled OUTSIDE AgentPortal (in
// page.tsx → UserProfilePage), so AgentPortal only handles these 3.
type AgentSection = 'search' | 'pending' | 'teacherView';

export default function AgentPortal({
  activeSection = 'search',
  onSectionChange,
}: {
  activeSection?: string;
  onSectionChange?: (s: string) => void;
}) {
  const { direction, isRTL } = useTranslations();
  const { signOut } = useAuthStore();
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [studentResult, setStudentResult] = useState<StudentResult | null>(null);
  // v116: student performance view — when the agent clicks "عرض الأداء"
  // on a searched student, this state is set + the search section switches
  // to showing the full performance data instead of the basic search results.
  const [viewingStudentId, setViewingStudentId] = useState<string | null>(null);
  const [viewingStudentName, setViewingStudentName] = useState<string>('');
  const [actioningOrderId, setActioningOrderId] = useState<string | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [self, setSelf] = useState<AgentSelf | null>(null);
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);
  const [selfError, setSelfError] = useState<string | null>(null);
  // v130: suspended-teacher modal state. When the teacher is banned, we show
  // a non-dismissible modal on portal mount explaining the agent can't act.
  const [teacherSuspended, setTeacherSuspended] = useState(false);
  const [suspendedTeacherName, setSuspendedTeacherName] = useState<string>('');
  const [suspendedReason, setSuspendedReason] = useState<string | null>(null);
  const [checkingSuspension, setCheckingSuspension] = useState(true);
  // v115: agent suspend/activate dialog state. Tracks which student is being
  // suspended/activated + the subjects available for selection (the student's
  // enrolled subjects in this agent's teacher's courses).
  const [suspendStudentId, setSuspendStudentId] = useState<string | null>(null);
  const [suspendStudentName, setSuspendStudentName] = useState<string>('');
  const [suspendSubjects, setSuspendSubjects] = useState<Array<{ id: string; name: string }>>([]);
  // v116 fix: initial state is '' (empty) so the GRID shows first when
  // the user opens Teacher View. Before this fix, the initial state was
  // 'dashboard' → the component skipped the grid and went straight to
  // the dashboard detail view (which is read-only) → the user never
  // saw the grid with the "إجراءات متاحة" badges → they thought the
  // whole Teacher View was read-only.
  const [teacherViewSection, setTeacherViewSection] = useState<string>('');
  const { confirmDialog, confirm } = useConfirmDialog();

  // ─── Fetch agent profile (for allowed_sections + display) ───
  // Surface real errors instead of silently swallowing, so the user
  // sees the actual reason (e.g., "agent not active", "agent not found")
  // in the SettingsSection UI rather than an infinite spinner.
  const fetchSelf = useCallback(async () => {
    setSelfError(null);
    try {
      const res = await fetch('/api/agent/me', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setSelf(json.agent as AgentSelf);
        setTeacher(json.teacher as TeacherInfo | null);
      } else {
        const err = json.error || 'تعذّر تحميل بيانات الوكيل';
        setSelfError(err);
        setSelf(null);
        setTeacher(null);
        // Also toast the error so the user notices immediately on first load.
        toast.error(err);
      }
    } catch (err) {
      const msg = err instanceof Error
        ? `تعذّر الاتصال بالخادم: ${err.message}`
        : 'تعذّر الاتصال بالخادم';
      setSelfError(msg);
      setSelf(null);
      toast.error(msg);
    }
  }, []);

  // v116 fix (A5): fetch /api/agent/me LAZILY — only when the user opens
  // the 'teacherView' section. Before this fix, the call fired on every
  // mount, including when the agent was just using 'search' or 'pending'.
  // The 'teacherView' is the only consumer of `self` + `teacher`, so
  // lazy-loading avoids an unnecessary API call on first paint.
  useEffect(() => {
    if (activeSection !== 'teacherView') return;
    // Only fetch when self is null (first open) — avoids refetching on
    // every re-render within the same 'teacherView' session.
    if (self !== null || selfError !== null) return;
    fetchSelf();
  }, [activeSection, self, selfError, fetchSelf]);

  // v130: Check on mount whether the teacher is banned/suspended.
  // This runs IMMEDIATELY (not lazily) because the suspended-teacher modal
  // must appear regardless of which section the agent is on.
  // Reuses /api/agent/me (which now returns teacher.is_banned).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/me', { headers: await getCachedAuthHeaders() });
        const json = await res.json();
        if (cancelled) return;
        if (json.success && json.teacher) {
          const t = json.teacher as TeacherInfo;
          if (t.is_banned) {
            setTeacherSuspended(true);
            setSuspendedTeacherName(t.name || 'المعلم');
            setSuspendedReason(t.ban_reason || null);
          }
        }
      } catch {
        // Non-fatal — if the check fails, the agent can still use the portal.
        // The ban check will retry on next mount.
      } finally {
        if (!cancelled) setCheckingSuspension(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Search student by code ───
  const searchStudent = async () => {
    if (!searchCode.trim()) { toast.error('أدخل كود الطالب'); return; }
    setSearching(true);
    setStudentResult(null);
    try {
      const res = await fetch('/api/agent/search-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ studentCode: searchCode.trim() }),
      });
      const json = await res.json();
      if (json.success) { setStudentResult(json); }
      else { toast.error(json.error || 'لم يتم العثور على الطالب'); }
    } catch { toast.error('حدث خطأ غير متوقع'); }
    finally { setSearching(false); }
  };

  // ─── Activate order ───
  const activateOrder = async (orderId: string) => {
    if (actioningOrderId) return;
    const ok = await confirm({
      title: 'تأكيد التفعيل',
      description: 'سيتم تفعيل الاشتراك لهذا الطالب.',
      confirmLabel: 'تفعيل', cancelLabel: 'تراجع',
    });
    if (!ok) return;
    setActioningOrderId(orderId);
    try {
      const res = await fetch('/api/agent/subscriptions/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم تفعيل الاشتراك');
        if (searchCode.trim()) searchStudent();
        fetchPendingOrders();
      } else { toast.error(json.error || 'فشل التفعيل'); }
    } catch { toast.error('حدث خطأ'); }
    finally { setActioningOrderId(null); }
  };

  // ─── Cancel order ───
  const cancelOrder = async (orderId: string) => {
    if (actioningOrderId) return;
    const ok = await confirm({
      title: 'تأكيد الإلغاء',
      description: 'إلغاء هذا الطلب؟ يمكن للطالب إنشاء طلب جديد بعد ذلك.',
      confirmLabel: 'إلغاء', cancelLabel: 'تراجع', variant: 'destructive',
    });
    if (!ok) return;
    setActioningOrderId(orderId);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/cancel`, {
        method: 'POST', headers: { ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إلغاء الطلب');
        if (searchCode.trim()) searchStudent();
        fetchPendingOrders();
      } else { toast.error(json.error || 'فشل الإلغاء'); }
    } catch { toast.error('حدث خطأ'); }
    finally { setActioningOrderId(null); }
  };

  // ─── Fetch all pending orders (agent-scoped endpoint) ───
  // Note: we use /api/agent/orders (requireAgent) — /api/teacher/orders
  // rejects the registration_agent role.
  const fetchPendingOrders = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await fetch('/api/agent/orders', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) { setPendingOrders(json.orders ?? []); }
      else {
        // Surface real errors instead of silently swallowing.
        toast.error(json.error || 'تعذّر جلب الطلبات المعلّقة');
        setPendingOrders([]);
      }
    } catch {
      toast.error('تعذّر الاتصال بالخادم لجلب الطلبات');
      setPendingOrders([]);
    } finally { setPendingLoading(false); }
  }, []);

  useEffect(() => {
    if (activeSection === 'pending') fetchPendingOrders();
  }, [activeSection, fetchPendingOrders]);

  // ─── Format helpers ───
  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  // ─── Resolve payment_order_id (no SUB-XXXX) ───
  const INTERNAL_PREFIXES = ['order_', 'free_', 'manual_', 'force_', 'backfill_', 'verify_', 'gateway_', 'pi_test_', 'pi_live_'];
  const resolveOrderId = (ref: string | null | undefined): string => {
    if (!ref) return '—';
    if (INTERNAL_PREFIXES.some(p => ref.startsWith(p))) return '—';
    return ref;
  };

  // v123: build a map of checkout_session_id → first order's provider_order_ref.
  // This lets us show "تم الدفع" for ALL orders in a multi-checkout session,
  // even those that don't have their own provider_order_ref.
  const sessionFirstRefMap = useMemo(() => {
    const m = new Map<string, string | null>();
    // From pendingOrders
    for (const o of pendingOrders) {
      if (o.checkout_session_id) {
        const hasOwnRef = !!o.provider_order_ref &&
          o.provider_order_ref.length > 5 &&
          !o.provider_order_ref.startsWith('order_') &&
          !o.provider_order_ref.startsWith('free_');
        if (hasOwnRef && !m.has(o.checkout_session_id)) {
          m.set(o.checkout_session_id, o.provider_order_ref);
        }
      }
    }
    // From studentResult.pending_orders
    if (studentResult?.pending_orders) {
      for (const o of studentResult.pending_orders) {
        if (o.checkout_session_id) {
          const hasOwnRef = !!o.provider_order_ref &&
            o.provider_order_ref.length > 5 &&
            !o.provider_order_ref.startsWith('order_') &&
            !o.provider_order_ref.startsWith('free_');
          if (hasOwnRef && !m.has(o.checkout_session_id)) {
            m.set(o.checkout_session_id, o.provider_order_ref);
          }
        }
      }
    }
    return m;
  }, [pendingOrders, studentResult]);

  // ─── Format price display ───
  // v123: show base_amount (أصل سعر المقرر) + fees (النسب) = grand_total
  // in a clean vertical layout. For free orders, show "مجاني" badge.
  const renderPriceBlock = (
    baseAmount: number | undefined | null,
    feesTotal: number | undefined | null,
    amount: number,
    currency: string,
  ) => {
    const isFree = !amount || amount === 0;

    if (isFree) {
      return (
        <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">
          <Gift className="h-3 w-3 me-1" />
          مجاني
        </Badge>
      );
    }

    const base = baseAmount != null ? Number(baseAmount) : null;
    const fees = feesTotal != null ? Number(feesTotal) : null;
    const grand = Number(amount);

    // If we have the breakdown, show it cleanly: base + fees = total
    if (base !== null && fees !== null && fees > 0) {
      return (
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] text-muted-foreground font-mono">
            أصل: {base.toFixed(2)} + رسوم: {fees.toFixed(2)}
          </span>
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 font-mono">
            {grand.toFixed(2)} {currency}
          </span>
        </div>
      );
    }

    // No breakdown available — just show the total
    return (
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 font-mono">
        {grand.toFixed(2)} {currency}
      </span>
    );
  };

  // ─── Format payment status badge ───
  // v123: shows whether the student has already paid on Paymob (but the
  // webhook hasn't activated the subscription yet) or hasn't paid yet.
  // For multi-checkout sessions: ALL orders in the session are considered
  // "paid" if the FIRST order has provider_order_ref (Paymob ID), even if
  // the other orders don't have their own provider_order_ref.
  // v126: for FREE orders, show "مجاني" badge + plan duration + timestamp.
  // Shows: badge + payment reference number + timestamp.
  const renderPaymentStatus = (
    order: {
      provider_order_ref: string | null;
      checkout_session_id?: string | null;
      created_at: string;
      amount: number;
      plan_duration_days?: number | null;
    },
    sessionFirstOrderRef?: string | null,
  ) => {
    const isFree = !order.amount || order.amount === 0;

    // v126: for free orders, show "مجاني" badge + duration + timestamp
    if (isFree) {
      const timestamp = new Date(order.created_at).toLocaleString('ar-EG', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      // v127: use actual days for custom durations (e.g., 3 days ≠ شهري)
      const durationDays = order.plan_duration_days ?? 30;
      const durationLabel = durationDays >= 365 ? 'سنوي' :
        durationDays >= 120 ? 'ترم' :
        durationDays >= 60 ? 'فصلين' :
        durationDays === 30 ? 'شهري' :
        `${durationDays} يوم`;
      return (
        <div className="flex flex-col items-end gap-0.5">
          <Badge variant="outline" className="text-[9px] border-sky-400 text-sky-700 bg-sky-50">
            <Gift className="h-2.5 w-2.5 me-0.5" />
            مجاني ({durationLabel})
          </Badge>
          <span className="text-[9px] text-muted-foreground">{timestamp}</span>
        </div>
      );
    }

    // Check if THIS order has a real Paymob ref
    const hasOwnRef = !!order.provider_order_ref &&
      order.provider_order_ref.length > 5 &&
      !order.provider_order_ref.startsWith('order_') &&
      !order.provider_order_ref.startsWith('free_');

    // Check if this order is part of a session where the FIRST order
    // has a Paymob ref (meaning the student paid for the whole session)
    const hasSessionRef = !!order.checkout_session_id &&
      !!sessionFirstOrderRef &&
      sessionFirstOrderRef.length > 5 &&
      !sessionFirstOrderRef.startsWith('order_') &&
      !sessionFirstOrderRef.startsWith('free_');

    const paymentInitiated = hasOwnRef || hasSessionRef;

    if (paymentInitiated) {
      // Student paid on Paymob — show payment ref + timestamp
      const ref = hasOwnRef ? order.provider_order_ref! : sessionFirstOrderRef!;
      const refLabel = hasOwnRef ? 'رقم العملية' : 'رقم العملية (جلسة)';
      const timestamp = new Date(order.created_at).toLocaleString('ar-EG', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      return (
        <div className="flex flex-col items-end gap-0.5">
          <Badge variant="outline" className="text-[9px] border-emerald-400 text-emerald-700 bg-emerald-50">
            <CheckCircle2 className="h-2.5 w-2.5 me-0.5" />
            تم الدفع
          </Badge>
          <span className="text-[9px] text-muted-foreground font-mono" dir="ltr" title={ref}>
            {refLabel}: {ref.length > 18 ? ref.slice(0, 18) + '…' : ref}
          </span>
          <span className="text-[9px] text-muted-foreground">{timestamp}</span>
        </div>
      );
    }

    // Not yet paid
    return (
      <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-700 bg-amber-50">
        <Clock className="h-2.5 w-2.5 me-0.5" />
        بانتظار الدفع
      </Badge>
    );
  };

  // ─── Allowed teacher sections (filtered by per-agent config) ───
  const visibleTeacherSections = useMemo(() => {
    if (!self?.allowed_sections) return TEACHER_SECTION_DEFS;
    return TEACHER_SECTION_DEFS.filter(def => self.allowed_sections!.includes(def.id));
  }, [self]);

  // v116 fix: when entering 'teacherView', if the current section selection
  // is NOT in the allowed list (and is not '' = grid view), reset to '' so
  // the grid shows. Don't auto-default to the first allowed section — that
  // would skip the grid and go straight to a detail view, which is how the
  // bug manifested (user never saw the grid with "إجراءات متاحة" badges).
  useEffect(() => {
    if (activeSection !== 'teacherView') return;
    if (teacherViewSection === '') return; // empty = grid view, don't touch
    const allowed = visibleTeacherSections.map(s => s.id);
    if (allowed.length > 0 && !allowed.includes(teacherViewSection)) {
      setTeacherViewSection(''); // reset to grid
    }
  }, [activeSection, visibleTeacherSections, teacherViewSection]);

  return (
    <div className="space-y-4 p-3 sm:p-6 max-w-4xl mx-auto" dir={direction}>
      {confirmDialog}

      {/* ════════ v130: Suspended-teacher full-screen block ════════ */}
      {/* If the teacher is banned, the agent sees a full-screen blocked page
          (similar to the banned-user overlay) with a sign-out button.
          The agent CANNOT use the portal at all while the teacher is suspended. */}
      {teacherSuspended && !checkingSuspension && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-l from-rose-500 to-rose-600 p-6 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/20 mb-4">
                <Ban className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">حساب المعلم موقوف</h2>
              <p className="text-rose-100 mt-2 text-sm">
                المعلم: {suspendedTeacherName}
              </p>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              {/* Ban reason */}
              {suspendedReason && (
                <div className="rounded-lg bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-900/40 p-4">
                  <p className="text-sm font-medium text-rose-700 dark:text-rose-400 mb-1">سبب الإيقاف</p>
                  <p className="text-sm text-rose-600 dark:text-rose-500">{suspendedReason}</p>
                </div>
              )}

              {/* Explanation */}
              <div className="rounded-lg bg-muted/50 dark:bg-muted/20 border p-4">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="h-5 w-5 text-rose-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">لا يمكنك استخدام البوابة</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      تم إيقاف حساب المعلم المرتبط بك. لا يمكنك تسجيل الطلاب أو تفعيل الاشتراكات
                      أو استخدام أي ميزة في البوابة حتى يتم رفع الإيقاف عن المعلم.
                    </p>
                  </div>
                </div>
              </div>

              {/* Restrictions list */}
              <div className="rounded-lg bg-muted/30 dark:bg-muted/10 border p-4">
                <p className="text-sm font-medium text-foreground mb-2">القيود المفروضة:</p>
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    لا يمكن تسجيل طلاب جدد
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    لا يمكن تفعيل أو إلغاء الاشتراكات
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    لا يمكن تصفح بيانات المعلم أو المقررات
                  </li>
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 shrink-0" />
                    تواصل مع إدارة المنصة للاستفسار عن رفع الإيقاف
                  </li>
                </ul>
              </div>

              {/* Sign out button */}
              <button
                onClick={() => signOut()}
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v130: While checking suspension status, show a loading spinner
          instead of the portal content. This prevents the portal from
          flashing briefly before the ban screen appears. */}
      {checkingSuspension && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* If teacher is NOT suspended AND check is done, render the portal normally */}
      {!teacherSuspended && !checkingSuspension && (
        <>
      {/* ════════ Section: SEARCH ════════ */}
      {activeSection === 'search' && (
        <>
          <header className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shrink-0">
              <Search className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">بوابة الوكيل</h1>
              <p className="text-sm text-muted-foreground">بحث عن الطلاب + تفعيل/إلغاء الاشتراكات</p>
            </div>
          </header>

          {/* Search bar */}
          <Card>
            <CardContent className="p-3">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={searchCode}
                  onChange={(e) => setSearchCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !searching) searchStudent(); }}
                  placeholder="كود الطالب..."
                  className="flex-1"
                  dir="ltr"
                />
                <Button onClick={searchStudent} disabled={searching || !searchCode.trim()}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  بحث
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Search results OR student performance view */}
          {viewingStudentId ? (
            <StudentPerformanceView
              studentId={viewingStudentId}
              studentName={viewingStudentName}
              onBack={() => { setViewingStudentId(null); setViewingStudentName(''); }}
            />
          ) : studentResult && (
            <div className="space-y-3">
              {/* Student info */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold truncate">{studentResult.student.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground truncate">{studentResult.student.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <Badge variant={studentResult.student.account_status === 'active' ? 'default' : 'secondary'}>
                        {studentResult.student.account_status === 'active' ? 'نشط' : 'قيد التفعيل'}
                      </Badge>
                      {/* v116 (C7): hide the suspend/activate button entirely when
                          the student has NO subjects (no enrollments + no pending
                          orders). Before this fix, the button always showed →
                          opening the dialog left the agent with an empty subject
                          dropdown + the awkward "لا توجد مقررات متاحة" message. */}
                      {(() => {
                        const enrolled = (studentResult.subscriptions ?? [])
                          .map(s => s.subject)
                          .filter((s): s is { id: string; name: string } => !!s && !!s.id && !!s.name);
                        const pendingSubjects = (studentResult.pending_orders ?? [])
                          .map(o => o.subject)
                          .filter((s): s is { id: string; name: string } => !!s && !!s.id && !!s.name);
                        const all = [...enrolled, ...pendingSubjects];
                        const seen = new Set<string>();
                        const unique = all.filter(s => {
                          if (seen.has(s.id)) return false;
                          seen.add(s.id);
                          return true;
                        });
                        if (unique.length === 0) return null;
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                            onClick={() => {
                              setSuspendStudentId(studentResult.student.id);
                              setSuspendStudentName(studentResult.student.name ?? studentResult.student.email ?? '—');
                              setSuspendSubjects(unique);
                            }}
                          >
                            <PauseCircle className="h-3.5 w-3.5 me-1" />
                            إيقاف / تنشيط
                          </Button>
                        );
                      })()}
                      {/* v116: "عرض الأداء" button — opens the full performance
                          view for this student (enrollments, assignments, quizzes,
                          attendance, lesson progress). */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-sky-300 text-sky-700 hover:bg-sky-50"
                        onClick={() => {
                          setViewingStudentId(studentResult.student.id);
                          setViewingStudentName(studentResult.student.name ?? studentResult.student.email ?? '—');
                        }}
                      >
                        <Activity className="h-3.5 w-3.5 me-1" />
                        عرض الأداء
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Pending orders (with activate/cancel) */}
              {studentResult.pending_orders.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-600" />
                      الطلبات المعلّقة ({studentResult.pending_orders.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {studentResult.pending_orders.map((o) => (
                        <div key={o.id} className="flex items-center justify-between gap-2 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{o.subject?.name ?? '—'}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                              {renderPriceBlock(o.base_amount, o.fees_total, o.amount, o.currency)}
                              <span>·</span>
                              <span>{formatDate(o.created_at)}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {renderPaymentStatus(o, o.checkout_session_id ? sessionFirstRefMap.get(o.checkout_session_id) : undefined)}
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-300 text-emerald-700"
                                disabled={actioningOrderId === o.id} onClick={() => activateOrder(o.id)}>
                                {actioningOrderId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                                تفعيل
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600"
                                disabled={actioningOrderId === o.id} onClick={() => cancelOrder(o.id)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Active subscriptions */}
              {studentResult.subscriptions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-emerald-600" />
                      الاشتراكات النشطة ({studentResult.subscriptions.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {studentResult.subscriptions.map((sub) => (
                        <div key={sub.id} className="flex items-center justify-between gap-2 p-3">
                          <span className="text-sm font-medium truncate">{sub.subject?.name ?? '—'}</span>
                          <Badge variant={sub.status === 'approved' ? 'default' : 'secondary'} className="text-xs">
                            {sub.status === 'approved' ? 'نشط' : sub.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ════════ Section: PENDING ORDERS ════════ */}
      {activeSection === 'pending' && (
        <>
          <header className="flex items-center justify-between">
            <h1 className="text-xl font-bold">الطلبات المعلّقة</h1>
            <Button size="sm" variant="ghost" onClick={fetchPendingOrders} disabled={pendingLoading}>
              {pendingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </header>

          {pendingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
            </div>
          ) : pendingOrders.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">لا توجد طلبات معلّقة حالياً.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y">
                  {pendingOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{o.subject?.name ?? '—'}</span>
                          <Badge variant="secondary" className="text-[10px]">{o.student?.name ?? '—'}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          {renderPriceBlock(o.base_amount, o.fees_total, o.amount, o.currency)}
                          <span>·</span>
                          <span>{formatDate(o.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {renderPaymentStatus(o, o.checkout_session_id ? sessionFirstRefMap.get(o.checkout_session_id) : undefined)}
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-300 text-emerald-700"
                            disabled={actioningOrderId === o.id} onClick={() => activateOrder(o.id)}>
                            {actioningOrderId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                            تفعيل
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600"
                            disabled={actioningOrderId === o.id} onClick={() => cancelOrder(o.id)}>
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ════════ Section: TEACHER VIEW (top-level, replaces old "Settings + students") ════════ */}
      {activeSection === 'teacherView' && (
        <TeacherViewSection
          self={self}
          teacher={teacher}
          selfError={selfError}
          onRetry={fetchSelf}
          teacherViewSection={teacherViewSection}
          setTeacherViewSection={setTeacherViewSection}
          visibleTeacherSections={visibleTeacherSections}
          isRTL={isRTL}
        />
      )}

      {/* v115: Agent-side student suspend/activate dialog */}
      <AgentStudentSuspendDialog
        open={suspendStudentId !== null}
        studentId={suspendStudentId}
        studentName={suspendStudentName}
        subjects={suspendSubjects}
        onClose={() => setSuspendStudentId(null)}
        onChanged={() => { /* refetch student search to update badges */ if (searchCode.trim()) searchStudent(); }}
      />
      </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TeacherViewSection — v116 (was SettingsSection — renamed for clarity)
//   Shows the agent's own profile + a 2-stage navigation for the
//   teacher's allowed sections:
//     Stage 1: A grid of section cards (Dashboard, Students, Subjects, …).
//              The agent picks one to drill down.
//     Stage 2: The selected section's content with a back button to
//              return to the grid. Some sections include actions
//              (approve/reject enrollments, activate/cancel orders,
//              suspend/activate students) — not purely read-only.
//
//   Before this restructure, all 18 section buttons + the preview were
//   crammed into ONE page → very long + hard to navigate. The 2-stage
//   approach gives the agent a clean "home" view + a dedicated page
//   per section.
//
//   If fetchSelf failed (e.g., the agent's row was deactivated or
//   deleted by the teacher, leaving role='registration_agent' but
//   no matching registration_agents row), we show a clear error
//   card with the actual server-side error message + a Retry
//   button — instead of an infinite spinner.
// ──────────────────────────────────────────────────────────────
function TeacherViewSection({
  self,
  teacher,
  selfError,
  onRetry,
  teacherViewSection,
  setTeacherViewSection,
  visibleTeacherSections,
  isRTL,
}: {
  self: AgentSelf | null;
  teacher: TeacherInfo | null;
  selfError: string | null;
  onRetry: () => void;
  teacherViewSection: string;
  setTeacherViewSection: (s: string) => void;
  visibleTeacherSections: Array<{ id: string; label: string; icon: React.ReactNode }>;
  isRTL: boolean;
}) {
  if (!self) {
    // Loading state OR error state.
    return (
      <>
        <header className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg shrink-0">
            <LayoutDashboard className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">عرض المعلم</h1>
            <p className="text-sm text-muted-foreground">بيانات الوكيل + أقسام المعلم المرئية لك</p>
          </div>
        </header>
        {selfError ? (
          <Card>
            <CardContent className="p-6 space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-rose-700 dark:text-rose-300">
                    تعذّر تحميل بيانات الوكيل
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selfError}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    قد يكون سبب ذلك أن المعلم أوقف حساب الوكيل أو حذفه. تواصل
                    مع المعلم للتأكد من حالة الوكيل، أو حاول مرة أخرى:
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={onRetry} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 me-1" />
                  إعادة المحاولة
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
          </div>
        )}
      </>
    );
  }

  const allowedIsAll = self.allowed_sections === null;
  const allowedCount = self.allowed_sections?.length ?? 0;
  const selectedSection = visibleTeacherSections.find(s => s.id === teacherViewSection);

  // ─── Stage 2: section detail view (when a section is selected) ───
  // Render a dedicated "page" for the selected section with a back
  // button at the top. This is much cleaner than the old layout that
  // crammed the section grid + the preview on one page.
  if (selectedSection) {
    return (
      <>
        <header className="flex items-center gap-3">
          <button
            onClick={() => setTeacherViewSection('')}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs hover:bg-muted transition-colors"
            title="رجوع لقائمة الأقسام"
            aria-label="رجوع"
          >
            <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          </button>
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg shrink-0">
            {selectedSection.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">{selectedSection.label}</h1>
            <p className="text-sm text-muted-foreground truncate">عرض المعلم</p>
          </div>
        </header>

        <Card>
          <CardContent className="space-y-2">
            <TeacherSectionPreview sectionId={selectedSection.id} />
          </CardContent>
        </Card>
      </>
    );
  }

  // ─── Stage 1: section grid (no section selected) ───
  return (
    <>
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg shrink-0">
          <LayoutDashboard className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">عرض المعلم</h1>
          <p className="text-sm text-muted-foreground">أقسام المعلم المرئية لك — اختر قسماً للمتابعة</p>
        </div>
      </header>

      {/* Agent profile summary (compact) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            بيانات الوكيل
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-muted-foreground">الاسم المعروض</p>
              <p className="font-medium">{self.display_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">النوع</p>
              <p className="font-medium">{self.kind ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">بريد التواصل</p>
              <p className="font-medium truncate" dir="ltr">{self.contact_email ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">هاتف التواصل</p>
              <p className="font-medium truncate" dir="ltr">{self.contact_phone ?? '—'}</p>
            </div>
          </div>
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">المعلم المسؤول</span>
              <span className="font-medium">{teacher?.name ?? '—'}</span>
            </div>
          </div>
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">صلاحيات عرض أقسام المعلم</span>
              <Badge variant={allowedIsAll ? 'default' : 'secondary'} className="text-[10px]">
                {allowedIsAll
                  ? 'كل الأقسام مسموحة'
                  : `${allowedCount} قسم مسموح`}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Teacher View section grid — bigger cards, each one a clear CTA */}
      {visibleTeacherSections.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-sky-600" />
              الأقسام المسموحة لك ({visibleTeacherSections.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2">
              {visibleTeacherSections.map((sec) => {
                // v116: sections with action buttons — show a badge so the
                // agent knows which sections they can DO things in (not just view).
                const hasActions = sec.id === 'students' || sec.id === 'pendingOrders';
                return (
                <button
                  key={sec.id}
                  onClick={() => setTeacherViewSection(sec.id)}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-start text-xs font-medium transition-all ${
                    isRTL ? 'flex-row-reverse text-end' : ''
                  } border-border hover:bg-sky-50 hover:border-sky-300 dark:hover:bg-sky-900/20 dark:hover:border-sky-700 text-slate-700 dark:text-slate-300 hover:text-sky-700 dark:hover:text-sky-300`}
                >
                  <span className="shrink-0 text-sky-600 dark:text-sky-400">{sec.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{sec.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {hasActions ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">إجراءات متاحة</span>
                      ) : (
                        'عرض البيانات'
                      )}
                    </div>
                  </div>
                  <ArrowRight className={`h-3 w-3 shrink-0 self-center text-muted-foreground ${isRTL ? 'rotate-180' : ''}`} />
                </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              المعلم لم يمنحك صلاحية الوصول لأي قسم من أقسامه. تواصل معه لتفعيل الصلاحيات.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// TeacherSectionPreview — v114 (real data)
//   Renders a READ-ONLY view of the teacher's data for the agent.
//   Fetches data from /api/agent/teacher-view?section=<id>.
//   Switches on the section id to render the appropriate layout.
//
//   Supported sections (with real data):
//     dashboard           — stats grid (subjects, students, pending, paid)
//     subjects            — list of subjects with name, level, students count, price
//     students            — list of students enrolled in the teacher's courses
//     pendingOrders       — list of pending orders (mirrors agent's Pending section)
//     registration        — list of other agents of the same teacher
//     summaries           — list of summaries
//     questionBank        — list of question banks
//     scormLibrary        — list of SCORM packages
//     financialManagement — monthly revenue aggregate per currency
//
//   Other sections (videos, files, todos, calendar, reports, analytics,
//   notifications, chat, tracking) render an informational placeholder
//   because their data shapes are complex and the agent's Teacher
//   View is a secondary feature; the teacher should use their own login
//   for those.
// ──────────────────────────────────────────────────────────────
const SECTION_LABELS: Record<string, string> = {
  dashboard: 'الرئيسية',
  subjects: 'المقررات',
  students: 'الطلاب',
  tracking: 'التتبع',
  summaries: 'الملخصات',
  questionBank: 'بنك الأسئلة',
  scormLibrary: 'مكتبة SCORM',
  pendingOrders: 'طلبات معلّقة',
  financialManagement: 'الإدارة المالية',
  chat: 'المحادثة',
  videos: 'الفيديوهات',
  files: 'الملفات',
  todos: 'المهام',
  calendar: 'التقويم',
  reports: 'البلاغات',
  analytics: 'التحليلات',
  notifications: 'الإشعارات',
  registration: 'وكلاء التسجيل',
};

function TeacherSectionPreview({ sectionId }: { sectionId: string }) {
  const { direction } = useTranslations();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  // v116: pagination — accumulate items across pages so "load more"
  // appends to the visible list instead of replacing it.
  const [items, setItems] = useState<unknown[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const LIMIT = 20;

  // Reset state when sectionId changes.
  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(false);
    setTotalCount(0);
    setData(null);
    setError(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/agent/teacher-view?section=${encodeURIComponent(sectionId)}&limit=${LIMIT}&offset=0`,
          { headers: await getCachedAuthHeaders() },
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setData(json);
          setItems(Array.isArray(json.items) ? json.items : []);
          setHasMore(!!json.has_more);
          setTotalCount(Number(json.total_count ?? (Array.isArray(json.items) ? json.items.length : 0)));
          setOffset(LIMIT);
        } else {
          setError(json.error || 'تعذّر تحميل البيانات');
        }
      } catch {
        if (!cancelled) setError('تعذّر الاتصال بالخادم');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sectionId]);

  // v116: listen for 'agent-teacher-view-refresh' events dispatched by
  // child views (StudentsView approve/reject, PendingOrdersView activate/
  // cancel, AgentStudentSuspendDialog onChanged). When the event fires,
  // we re-fetch the current section's data so the UI reflects the change
  // immediately (e.g., an approved enrollment disappears from the pending
  // list, an activated order disappears from the pending orders list).
  useEffect(() => {
    const handler = () => {
      // Reset + refetch.
      setItems([]);
      setOffset(0);
      setHasMore(false);
      setTotalCount(0);
      setData(null);
      setError(null);
      setLoading(true);
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(
            `/api/agent/teacher-view?section=${encodeURIComponent(sectionId)}&limit=${LIMIT}&offset=0`,
            { headers: await getCachedAuthHeaders() },
          );
          const json = await res.json();
          if (cancelled) return;
          if (json.success) {
            setData(json);
            setItems(Array.isArray(json.items) ? json.items : []);
            setHasMore(!!json.has_more);
            setTotalCount(Number(json.total_count ?? (Array.isArray(json.items) ? json.items.length : 0)));
            setOffset(LIMIT);
          } else {
            setError(json.error || 'تعذّر تحميل البيانات');
          }
        } catch {
          if (!cancelled) setError('تعذّر الاتصال بالخادم');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    };
    window.addEventListener('agent-teacher-view-refresh', handler);
    return () => window.removeEventListener('agent-teacher-view-refresh', handler);
  }, [sectionId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/agent/teacher-view?section=${encodeURIComponent(sectionId)}&limit=${LIMIT}&offset=${offset}`,
        { headers: await getCachedAuthHeaders() },
      );
      const json = await res.json();
      if (json.success) {
        const newItems = Array.isArray(json.items) ? json.items : [];
        setItems(prev => [...prev, ...newItems]);
        setHasMore(!!json.has_more);
        setOffset(prev => prev + LIMIT);
      } else {
        toast.error(json.error || 'تعذّر تحميل المزيد');
      }
    } catch {
      toast.error('تعذّر الاتصال بالخادم');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950 dark:border-rose-800 p-3 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  // Merge the accumulated items back into the data object so each
  // per-section view reads them from the same place.
  const mergedData = data ? { ...data, items } : null;

  return (
    <div dir={direction} className="space-y-2">
      {totalCount > 0 && (
        <div className="text-[10px] text-muted-foreground text-end">
          عُرض {items.length} من {totalCount}
        </div>
      )}
      {renderSectionContent(sectionId, mergedData)}
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button size="sm" variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin me-1" /> : <ChevronDown className="h-3.5 w-3.5 me-1" />}
            عرض المزيد
          </Button>
        </div>
      )}
    </div>
  );
}

function renderSectionContent(sectionId: string, data: Record<string, unknown> | null) {
  if (!data) return null;
  const note = data.note as string | undefined;
  if (note) {
    // Server returned a placeholder note for unsupported sections.
    return (
      <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-900/30 text-xs text-muted-foreground">
        {note}
      </div>
    );
  }

  switch (sectionId) {
    case 'dashboard':
      return <DashboardView data={data} />;
    case 'subjects':
      return <SubjectsView data={data} />;
    case 'students':
      return <StudentsView data={data} />;
    case 'pendingOrders':
      return <PendingOrdersView data={data} />;
    case 'registration':
      return <RegistrationView data={data} />;
    case 'summaries':
    case 'questionBank':
    case 'scormLibrary':
      return <ItemsListView data={data} idField="id" titleField="title" subtitleField="subject.name" emptyMsg="لا توجد عناصر" />;
    case 'financialManagement':
      return <FinancialView data={data} />;
    case 'videos':
      return <ItemsListView data={data} idField="id" titleField="title" subtitleField="subject.name" emptyMsg="لا توجد فيديوهات" />;
    case 'files':
      return <ItemsListView data={data} idField="id" titleField="name" subtitleField="subject.name" emptyMsg="لا توجد ملفات" />;
    case 'todos':
      return <TodosView data={data} />;
    case 'notifications':
      return <NotificationsView data={data} />;
    case 'analytics':
      return <AnalyticsView data={data} />;
    default:
      return (
        <div className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-900/30 text-xs text-muted-foreground">
          القسم المحدد: <span className="font-medium">{SECTION_LABELS[sectionId] ?? sectionId}</span>
          <br />
          معاينة لهذا القسم غير متاحة للوكيل حالياً — يجب على المعلم الدخول لحسابه لرؤية المحتوى الكامل.
        </div>
      );
  }
}

// ──────────────────────────────────────────────────────────────
// v116: per-section views for the newly-added handlers
// ──────────────────────────────────────────────────────────────

function TodosView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    id: string; title: string; completed: boolean;
    due_date: string | null; created_at: string;
  }>;
  if (items.length === 0) return <EmptyState label="لا توجد مهام" />;
  return (
    <div className="rounded-md border border-border/60 divide-y max-h-[400px] overflow-y-auto">
      {items.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2 p-2.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-medium truncate ${t.completed ? 'line-through text-muted-foreground' : ''}`}>
                {t.title}
              </span>
              {t.completed && (
                <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                  مكتمل
                </Badge>
              )}
            </div>
            {t.due_date && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                ينتهي: {new Date(t.due_date).toLocaleDateString('ar-EG')}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationsView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    id: string; title: string; body: string | null;
    type: string | null; is_read: boolean; created_at: string;
  }>;
  if (items.length === 0) return <EmptyState label="لا توجد إشعارات" />;
  return (
    <div className="rounded-md border border-border/60 divide-y max-h-[400px] overflow-y-auto">
      {items.map((n) => (
        <div key={n.id} className={`p-2.5 text-xs ${!n.is_read ? 'bg-sky-50/40 dark:bg-sky-900/15' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{n.title || '—'}</span>
            {!n.is_read && (
              <Badge variant="default" className="text-[9px] bg-sky-100 text-sky-700 border-sky-200">جديد</Badge>
            )}
          </div>
          {n.body && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
          )}
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {new Date(n.created_at).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsView({ data }: { data: Record<string, unknown> }) {
  const stats = (data.stats ?? {}) as {
    total_enrollments: number;
    active_subscriptions: number;
    pending_orders: number;
    paid_orders: number;
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <StatTile label="إجمالي التسجيلات" value={stats.total_enrollments ?? 0} color="sky" icon={<Users className="h-3.5 w-3.5" />} />
      <StatTile label="اشتراكات نشطة" value={stats.active_subscriptions ?? 0} color="teal" icon={<BadgeCheck className="h-3.5 w-3.5" />} />
      <StatTile label="طلبات معلّقة" value={stats.pending_orders ?? 0} color="amber" icon={<Clock className="h-3.5 w-3.5" />} />
      <StatTile label="طلبات مدفوعة" value={stats.paid_orders ?? 0} color="emerald" icon={<BadgeCheck className="h-3.5 w-3.5" />} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Per-section views
// ──────────────────────────────────────────────────────────────

function DashboardView({ data }: { data: Record<string, unknown> }) {
  const stats = (data.stats ?? {}) as {
    total_subjects: number;
    total_students: number;
    pending_orders: number;
    paid_orders: number;
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <StatTile label="المقررات" value={stats.total_subjects ?? 0} color="sky" icon={<BookOpen className="h-3.5 w-3.5" />} />
      <StatTile label="الطلاب" value={stats.total_students ?? 0} color="teal" icon={<Users className="h-3.5 w-3.5" />} />
      <StatTile label="طلبات معلّقة" value={stats.pending_orders ?? 0} color="amber" icon={<Clock className="h-3.5 w-3.5" />} />
      <StatTile label="طلبات مدفوعة" value={stats.paid_orders ?? 0} color="emerald" icon={<BadgeCheck className="h-3.5 w-3.5" />} />
    </div>
  );
}

function StatTile({ label, value, color, icon }: {
  label: string; value: number; color: 'sky' | 'teal' | 'amber' | 'emerald';
  icon: React.ReactNode;
}) {
  const colorMap: Record<string, string> = {
    sky: 'border-sky-200 bg-sky-50/60 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
    teal: 'border-teal-200 bg-teal-50/60 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300',
    amber: 'border-amber-200 bg-amber-50/60 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${colorMap[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] opacity-80">{label}</span>
        <span className="opacity-80">{icon}</span>
      </div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}

function SubjectsView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    id: string; name: string; level: string | null; sub_level: string | null;
    price: number | null; is_paused: boolean; students_count: number;
  }>;
  if (items.length === 0) return <EmptyState label="لا توجد مقررات" />;
  return (
    <div className="rounded-md border border-border/60 divide-y max-h-[400px] overflow-y-auto">
      {items.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 p-2.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{s.name}</span>
              {s.is_paused && (
                <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">متوقّف</Badge>
              )}
              {s.level && (
                <Badge variant="secondary" className="text-[9px]">{s.level}{s.sub_level ? ` - ${s.sub_level}` : ''}</Badge>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {s.students_count} طالب
            </div>
          </div>
          <div className="shrink-0 text-end">
            {s.price !== null && s.price > 0 ? (
              <span className="font-medium text-emerald-700 dark:text-emerald-300">{Number(s.price).toFixed(2)} EGP</span>
            ) : (
              <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200"><Gift className="h-2.5 w-2.5 me-0.5" />مجاني</Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudentsView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    id: string; name: string | null; email: string;
    username: string | null; student_code: string | null;
    account_status: string | null;
    enrollments: Array<{ subject_id: string; subject_name: string; status: string; enrolled_at: string | null }>;
  }>;

  // v116 (C4): pending enrollment requests — extract from the data
  // fetched by handleStudents (which now includes pending_enrollments).
  const pendingEnrollments = (data.pending_enrollments ?? []) as Array<{
    enrollment_id: string;
    student_id: string;
    student_name: string | null;
    student_email: string;
    student_code: string | null;
    subject_id: string;
    subject_name: string;
    enrollment_method: string;
    enrolled_at: string | null;
  }>;

  const [actioningId, setActioningId] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string; subjects: Array<{ id: string; name: string }> } | null>(null);

  const handleApprove = async (subjectId: string, studentId: string, enrollmentId: string) => {
    setActioningId(enrollmentId);
    try {
      const res = await fetch('/api/agent/enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ action: 'approve', subjectId, studentId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم قبول الطلب (${json.affected} طالب)`);
        // Reload the section data — the parent TeacherSectionPreview will refetch.
        window.dispatchEvent(new CustomEvent('agent-teacher-view-refresh'));
      } else {
        toast.error(json.error || 'فشل قبول الطلب');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (subjectId: string, studentId: string, enrollmentId: string) => {
    setActioningId(enrollmentId);
    try {
      const res = await fetch('/api/agent/enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ action: 'reject', subjectId, studentId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم رفض الطلب`);
        window.dispatchEvent(new CustomEvent('agent-teacher-view-refresh'));
      } else {
        toast.error(json.error || 'فشل رفض الطلب');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* ─── Pending enrollment requests (C4) — show at the top ─── */}
      {pendingEnrollments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              طلبات الانضمام المعلّقة ({pendingEnrollments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {pendingEnrollments.map((req) => (
                <div key={req.enrollment_id} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{req.student_name ?? '—'}</span>
                      {req.student_code && (
                        <span className="font-mono text-[10px] text-muted-foreground">({req.student_code})</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{req.subject_name}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-[10px] border-emerald-300 text-emerald-700"
                      disabled={actioningId === req.enrollment_id}
                      onClick={() => handleApprove(req.subject_id, req.student_id, req.enrollment_id)}
                    >
                      {actioningId === req.enrollment_id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <BadgeCheck className="h-3 w-3" />}
                      قبول
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-[10px] text-rose-600"
                      disabled={actioningId === req.enrollment_id}
                      onClick={() => handleReject(req.subject_id, req.student_id, req.enrollment_id)}
                    >
                      {actioningId === req.enrollment_id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <XCircle className="h-3 w-3" />}
                      رفض
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Enrolled students list (C3 — with "manage" button) ─── */}
      {items.length === 0 && pendingEnrollments.length === 0 ? (
        <EmptyState label="لا يوجد طلاب" />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-teal-600" />
              الطلاب المسجلون ({items.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-[400px] overflow-y-auto">
              {items.map((s) => (
                <div key={s.id} className="p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{s.name ?? '—'}</span>
                        {s.student_code && (
                          <span className="font-mono text-[10px] text-muted-foreground">({s.student_code})</span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate" dir="ltr">{s.email}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge
                        variant={s.account_status === 'active' ? 'default' : 'secondary'}
                        className="text-[9px]"
                      >
                        {s.account_status === 'active' ? 'نشط' : 'قيد التفعيل'}
                      </Badge>
                      {/* v116 (C3): "manage" button — opens the AgentStudentSuspendDialog
                          with the student's subjects pre-populated. */}
                      {(() => {
                        const subjects = (s.enrollments ?? []).map(e => ({ id: e.subject_id, name: e.subject_name }));
                        if (subjects.length === 0) return null;
                        return (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-[10px] border-amber-300 text-amber-700"
                            onClick={() => setSuspendTarget({
                              id: s.id,
                              name: s.name ?? s.email ?? '—',
                              subjects,
                            })}
                          >
                            <PauseCircle className="h-3 w-3 me-0.5" />
                            إدارة
                          </Button>
                        );
                      })()}
                    </div>
                  </div>
                  {s.enrollments.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                      {s.enrollments.slice(0, 5).map((e, idx) => (
                        <span key={`${e.subject_id}-${idx}`} className="rounded bg-muted px-1.5 py-0.5">
                          {e.subject_name} · {e.status}
                        </span>
                      ))}
                      {s.enrollments.length > 5 && (
                        <span className="text-[9px]">+{s.enrollments.length - 5} أخرى</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* v116 (C3): suspend/activate dialog for the selected student */}
      {suspendTarget && (
        <AgentStudentSuspendDialog
          open={true}
          studentId={suspendTarget.id}
          studentName={suspendTarget.name}
          subjects={suspendTarget.subjects}
          onClose={() => setSuspendTarget(null)}
          onChanged={() => window.dispatchEvent(new CustomEvent('agent-teacher-view-refresh'))}
        />
      )}
    </div>
  );
}

function PendingOrdersView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    id: string; amount: number; currency: string; status: string; created_at: string;
    provider_order_ref: string | null;
    plan_duration_days?: number | null;
    student: { id: string; name: string | null; email: string; student_code: string | null } | null;
    subject: { id: string; name: string; price: number | null } | null;
  }>;
  const [actioningId, setActioningId] = useState<string | null>(null);
  // v116 fix: MUST destructure + render `confirmDialog` — the hook returns
  // a JSX element that renders the AlertDialog. Without rendering it, the
  // `confirm()` promise never resolves (the dialog is never shown) → the
  // activate/cancel actions hang forever → the user thinks the buttons
  // don't work.
  const { confirmDialog: pendingConfirmDialog, confirm } = useConfirmDialog();

  if (items.length === 0) return <>{pendingConfirmDialog}<EmptyState label="لا توجد طلبات معلّقة" /></>;
  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  const handleActivate = async (orderId: string) => {
    const ok = await confirm({
      title: 'تأكيد التفعيل',
      description: 'سيتم تفعيل الاشتراك لهذا الطالب.',
      confirmLabel: 'تفعيل', cancelLabel: 'تراجع',
    });
    if (!ok) return;
    setActioningId(orderId);
    try {
      const res = await fetch('/api/agent/subscriptions/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ orderId }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم تفعيل الاشتراك');
        window.dispatchEvent(new CustomEvent('agent-teacher-view-refresh'));
      } else {
        toast.error(json.error || 'فشل التفعيل');
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setActioningId(null);
    }
  };

  const handleCancel = async (orderId: string) => {
    const ok = await confirm({
      title: 'تأكيد الإلغاء',
      description: 'إلغاء هذا الطلب؟ يمكن للطالب إنشاء طلب جديد بعد ذلك.',
      confirmLabel: 'إلغاء', cancelLabel: 'تراجع', variant: 'destructive',
    });
    if (!ok) return;
    setActioningId(orderId);
    try {
      const res = await fetch(`/api/agent/orders/${orderId}/cancel`, {
        method: 'POST', headers: { ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إلغاء الطلب');
        window.dispatchEvent(new CustomEvent('agent-teacher-view-refresh'));
      } else {
        toast.error(json.error || 'فشل الإلغاء');
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setActioningId(null);
    }
  };

  return (
    <>
    <div className="rounded-md border border-border/60 divide-y max-h-[400px] overflow-y-auto">
      {items.map((o) => {
        const isFree = !o.amount || o.amount === 0;
        return (
          <div key={o.id} className="p-2.5 text-xs space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{o.subject?.name ?? '—'}</span>
                  <Badge variant="secondary" className="text-[9px]">{o.student?.name ?? '—'}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{formatDate(o.created_at)}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isFree ? (
                  (() => {
                    const dDays = o.plan_duration_days ?? 30;
                    const dLabel = dDays >= 365 ? 'سنوي' :
                      dDays >= 120 ? 'ترم' :
                      dDays >= 60 ? 'فصلين' :
                      dDays === 30 ? 'شهري' :
                      `${dDays} يوم`;
                    return (
                      <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200">
                        <Gift className="h-2.5 w-2.5 me-0.5" />مجاني ({dLabel})
                      </Badge>
                    );
                  })()
                ) : (
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">
                    {Number(o.amount).toFixed(2)} {o.currency}
                  </span>
                )}
              </div>
            </div>
            {/* v116 (C2): activate/cancel buttons — same as the search section's
                pending orders card, but inside the Teacher View's pendingOrders
                section. Uses the same /api/agent/subscriptions/activate +
                /api/agent/orders/[id]/cancel endpoints. */}
            <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
              <Button
                size="sm" variant="outline"
                className="h-7 text-[10px] border-emerald-300 text-emerald-700"
                disabled={actioningId === o.id}
                onClick={() => handleActivate(o.id)}
              >
                {actioningId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                تفعيل
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-7 text-[10px] text-rose-600"
                disabled={actioningId === o.id}
                onClick={() => handleCancel(o.id)}
              >
                {actioningId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                إلغاء
              </Button>
            </div>
          </div>
        );
      })}
    </div>
    {/* v116 fix: render the confirm dialog — without this, the confirm()
        promise never resolves and the actions hang. */}
    {pendingConfirmDialog}
    </>
  );
}

function RegistrationView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    id: string; display_name: string | null; kind: string | null;
    is_active: boolean; created_at: string;
    user: { id: string; email: string; name: string | null } | null;
  }>;
  if (items.length === 0) return <EmptyState label="لا يوجد وكلاء آخرون" />;
  return (
    <div className="rounded-md border border-border/60 divide-y max-h-[400px] overflow-y-auto">
      {items.map((a) => (
        <div key={a.id} className="p-2.5 text-xs flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{a.display_name ?? a.user?.name ?? '—'}</span>
              {a.is_active ? (
                <Badge variant="default" className="text-[9px]">نشط</Badge>
              ) : (
                <Badge variant="destructive" className="text-[9px]">معطّل</Badge>
              )}
              {a.kind && (
                <Badge variant="secondary" className="text-[9px]">{a.kind}</Badge>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate" dir="ltr">
              {a.user?.email ?? '—'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemsListView({ data, idField, titleField, subtitleField, emptyMsg }: {
  data: Record<string, unknown>;
  idField: string; titleField: string; subtitleField: string; emptyMsg: string;
}) {
  const items = (data.items ?? []) as Array<Record<string, unknown>>;
  if (items.length === 0) return <EmptyState label={emptyMsg} />;

  // Resolve nested field paths like 'subject.name' from the item.
  const resolve = (obj: Record<string, unknown>, path: string): unknown => {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  };

  return (
    <div className="rounded-md border border-border/60 divide-y max-h-[400px] overflow-y-auto">
      {items.map((item) => {
        const id = String(item[idField] ?? '');
        const title = String(resolve(item, titleField) ?? '—');
        const subtitle = resolve(item, subtitleField);
        const subtitleText: string = subtitle === null || subtitle === undefined
          ? ''
          : typeof subtitle === 'object'
          ? JSON.stringify(subtitle)
          : String(subtitle);
        return (
          <div key={id} className="p-2.5 text-xs flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{title}</p>
              {subtitleText && (
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {subtitleText}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FinancialView({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as Array<{
    currency: string; gross: number; teacher: number; platform: number; count: number;
  }>;
  const period = data.period as { from: string; to: string } | undefined;
  if (items.length === 0) {
    return <EmptyState label="لا توجد بيانات مالية لهذا الشهر" />;
  }
  return (
    <div className="space-y-2">
      {period && (
        <p className="text-[10px] text-muted-foreground text-center">
          بيانات الشهر الحالي
        </p>
      )}
      <div className="rounded-md border border-border/60 divide-y">
        {items.map((row) => (
          <div key={row.currency} className="p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.currency}</span>
              <span className="text-[10px] text-muted-foreground">{row.count} معاملة</span>
            </div>
            <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px]">
              <div>
                <p className="text-muted-foreground">الإجمالي</p>
                <p className="font-medium text-sky-700 dark:text-sky-300">{row.gross.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">نص المعلم</p>
                <p className="font-medium text-emerald-700 dark:text-emerald-300">{row.teacher.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">نص المنصة</p>
                <p className="font-medium text-amber-700 dark:text-amber-300">{row.platform.toFixed(2)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// StudentPerformanceView — v116
//   Full performance view for a single student. Shown when the
//   agent clicks "عرض الأداء" on a searched student.
//   Fetches: enrollments, assignments (submitted + not), quizzes
//   (completed + not), attendance, lesson progress.
// ──────────────────────────────────────────────────────────────
function StudentPerformanceView({ studentId, studentName, onBack }: {
  studentId: string;
  studentName: string;
  onBack: () => void;
}) {
  const { direction, isRTL } = useTranslations();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await fetch(`/api/agent/student-performance/${studentId}`, {
          headers: await getCachedAuthHeaders(),
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          setData(json);
        } else {
          setError(json.error || 'تعذّر تحميل البيانات');
        }
      } catch {
        if (!cancelled) setError('تعذّر الاتصال بالخادم');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [studentId]);

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-700 dark:text-rose-300">تعذّر تحميل الأداء</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          </div>
          <Button onClick={onBack} variant="outline" size="sm">
            <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
            رجوع
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const student = data.student as { name: string | null; email: string; student_code: string | null; account_status: string | null };
  const enrollments = (data.enrollments ?? []) as Array<{
    subject_name: string; status: string; enrollment_method: string;
    current_period_start: string | null; current_period_end: string | null; monthly_price: number | null;
  }>;
  const assignmentsSubmitted = ((data.assignments as Record<string, unknown>)?.submitted ?? []) as Array<Record<string, unknown>>;
  const assignmentsNotSubmitted = ((data.assignments as Record<string, unknown>)?.not_submitted ?? []) as Array<Record<string, unknown>>;
  const quizzesCompleted = ((data.quizzes as Record<string, unknown>)?.completed ?? []) as Array<Record<string, unknown>>;
  const quizzesNotCompleted = ((data.quizzes as Record<string, unknown>)?.not_completed ?? []) as Array<Record<string, unknown>>;
  const attendance = (data.attendance ?? []) as Array<Record<string, unknown>>;
  const lessonProgress = (data.lesson_progress ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-3" dir={direction}>
      {/* Header with back button */}
      <header className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="shrink-0 flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs hover:bg-muted transition-colors"
          title="رجوع"
        >
          <ChevronRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
        </button>
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-teal-500 flex items-center justify-center shadow-lg shrink-0">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{studentName}</h1>
          <p className="text-sm text-muted-foreground truncate">أداء الطالب — متابعة شاملة</p>
        </div>
        <Badge variant={student.account_status === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
          {student.account_status === 'active' ? 'نشط' : 'قيد التفعيل'}
        </Badge>
      </header>

      {/* Enrollments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-sky-600" />
            الاشتراكات ({enrollments.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {enrollments.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">لا توجد اشتراكات</div>
          ) : (
            <div className="divide-y max-h-[200px] overflow-y-auto">
              {enrollments.map((e, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{e.subject_name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {e.current_period_end ? `ينتهي: ${formatDate(e.current_period_end)}` : 'دائم'}
                    </p>
                  </div>
                  <Badge variant={e.status === 'approved' ? 'default' : 'secondary'} className="text-[9px] shrink-0">
                    {e.status === 'approved' ? 'نشط' : e.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assignments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-600" />
            التكليفات (مسلّمة: {assignmentsSubmitted.length} — غير مسلّمة: {assignmentsNotSubmitted.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {assignmentsSubmitted.length === 0 && assignmentsNotSubmitted.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">لا توجد تكليفات</div>
          ) : (
            <div className="divide-y max-h-[250px] overflow-y-auto">
              {assignmentsSubmitted.map((a, i) => (
                <div key={`s${i}`} className="flex items-center justify-between gap-2 p-2.5 text-xs bg-emerald-50/30">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{String(a.title ?? "—")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{String(a.subject_name ?? "—")}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <span className="font-mono text-emerald-700 dark:text-emerald-300">
                      {Number(a.score ?? 0).toFixed(0)}/{Number(a.max_score ?? 0)}
                    </span>
                    <Badge variant="outline" className="text-[9px] ms-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                      مسلّمة
                    </Badge>
                  </div>
                </div>
              ))}
              {assignmentsNotSubmitted.map((a, i) => (
                <div key={`n${i}`} className="flex items-center justify-between gap-2 p-2.5 text-xs bg-rose-50/30">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{String(a.title ?? "—")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {String(a.subject_name ?? "—")}
                      {a.due_date ? ` · يستحق تسليم: ${formatDate(a.due_date as string)}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0 bg-rose-50 text-rose-700 border-rose-200">
                    غير مسلّمة
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quizzes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-600" />
            الاختبارات (مكتملة: {quizzesCompleted.length} — غير مكتملة: {quizzesNotCompleted.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {quizzesCompleted.length === 0 && quizzesNotCompleted.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">لا توجد اختبارات</div>
          ) : (
            <div className="divide-y max-h-[250px] overflow-y-auto">
              {quizzesCompleted.map((q, i) => (
                <div key={`q${i}`} className="flex items-center justify-between gap-2 p-2.5 text-xs bg-emerald-50/30">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{String(q.title ?? "—")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{String(q.subject_name ?? "—")}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <span className="font-mono text-emerald-700 dark:text-emerald-300">
                      {Number(q.score ?? 0).toFixed(0)}/{Number(q.max_score ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
              {quizzesNotCompleted.map((q, i) => (
                <div key={`qn${i}`} className="flex items-center justify-between gap-2 p-2.5 text-xs bg-rose-50/30">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{String(q.title ?? "—")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{String(q.subject_name ?? "—")}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0 bg-rose-50 text-rose-700 border-rose-200">
                    لم يؤدها
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-teal-600" />
            الحضور ({attendance.length} مقرر)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {attendance.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">لا توجد بيانات حضور</div>
          ) : (
            <div className="divide-y">
              {attendance.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{String(a.subject_name ?? "—")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      حاضر: {Number(a.present ?? 0)} · متأخر: {Number(a.late ?? 0)} · غائب: {Number(a.absent ?? 0)}
                    </p>
                  </div>
                  <Badge
                    variant={Number(a.percentage ?? 0) >= 75 ? 'default' : 'destructive'}
                    className="text-[9px] shrink-0"
                  >
                    {Number(a.percentage ?? 0)}%
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lesson Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-600" />
            تقدم الدروس ({lessonProgress.length} مقرر)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lessonProgress.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">لا توجد بيانات تقدم</div>
          ) : (
            <div className="divide-y">
              {lessonProgress.map((lp, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-2.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{String(lp.subject_name ?? "—")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      أكمل: {Number(lp.completed_lessons ?? 0)} من {Number(lp.total_lessons ?? 0)} درس
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {Number(lp.percentage ?? 0)}%
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
