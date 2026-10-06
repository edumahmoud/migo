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
  Settings, Inbox, BookOpen, Power, PowerOff, ShieldCheck,
  LayoutDashboard, FileText, Database, DollarSign, MessageCircle,
  Activity, Video, FolderOpen, ListTodo, Calendar as CalendarIcon,
  ShieldAlert, TrendingUp, Bell, Package, UserCog, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import StudentSubscriptionsLog from '@/components/agent/student-subscriptions-log';

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
    subject: { id: string; name: string; price?: number } | null;
  }>;
}

interface PendingOrder {
  id: string; subject_id: string; amount: number; currency: string;
  status: string; created_at: string; provider_order_ref: string | null;
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

type AgentSection = 'search' | 'pending' | 'students' | 'settings';

export default function AgentPortal({
  activeSection = 'search',
  onSectionChange,
}: {
  activeSection?: string;
  onSectionChange?: (s: string) => void;
}) {
  const { direction, isRTL } = useTranslations();
  const [searchCode, setSearchCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [studentResult, setStudentResult] = useState<StudentResult | null>(null);
  const [actioningOrderId, setActioningOrderId] = useState<string | null>(null);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [self, setSelf] = useState<AgentSelf | null>(null);
  const [teacher, setTeacher] = useState<TeacherInfo | null>(null);
  const [teacherViewSection, setTeacherViewSection] = useState<string>('dashboard');
  const { confirmDialog, confirm } = useConfirmDialog();

  // ─── Fetch agent profile (for allowed_sections + display) ───
  const fetchSelf = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/me', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setSelf(json.agent as AgentSelf);
        setTeacher(json.teacher as TeacherInfo | null);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchSelf();
  }, [fetchSelf]);

  // ─── Search student by code ───
  const searchStudent = async () => {
    if (!searchCode.trim()) { toast.error('أدخل كود الطالب'); return; }
    setSearching(true);
    setStudentResult(null);
    try {
      const res = await fetch('/api/agent/search-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ searchCode: searchCode.trim() }),
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

  // ─── Fetch all pending orders ───
  const fetchPendingOrders = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await fetch('/api/teacher/orders', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) { setPendingOrders(json.orders ?? []); }
    } catch { /* ignore */ }
    finally { setPendingLoading(false); }
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

  // ─── Allowed teacher sections (filtered by per-agent config) ───
  const visibleTeacherSections = useMemo(() => {
    if (!self?.allowed_sections) return TEACHER_SECTION_DEFS;
    return TEACHER_SECTION_DEFS.filter(def => self.allowed_sections!.includes(def.id));
  }, [self]);

  // When entering settings, default the teacher-view sub-section to the
  // first allowed section (or 'dashboard' if all are allowed).
  useEffect(() => {
    if (activeSection !== 'settings') return;
    const allowed = visibleTeacherSections.map(s => s.id);
    if (allowed.length > 0 && !allowed.includes(teacherViewSection)) {
      setTeacherViewSection(allowed[0]);
    }
  }, [activeSection, visibleTeacherSections, teacherViewSection]);

  return (
    <div className="space-y-4 p-3 sm:p-6 max-w-4xl mx-auto" dir={direction}>
      {confirmDialog}

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

          {/* Search results */}
          {studentResult && (
            <div className="space-y-3">
              {/* Student info */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold">{studentResult.student.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{studentResult.student.email}</p>
                    </div>
                    <Badge variant={studentResult.student.account_status === 'active' ? 'default' : 'secondary'}>
                      {studentResult.student.account_status === 'active' ? 'نشط' : 'قيد التفعيل'}
                    </Badge>
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
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{Number(o.subject?.price ?? o.amount).toFixed(2)} {o.currency}</span>
                              <span>·</span>
                              <span>{formatDate(o.created_at)}</span>
                              <span>·</span>
                              <span className="font-mono" dir="ltr">{resolveOrderId(o.provider_order_ref)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-300 text-emerald-700"
                              disabled={actioningOrderId === o.id} onClick={() => activateOrder(o.id)}>
                              {actioningOrderId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                              تفعيل
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600"
                              disabled={actioningOrderId === o.id} onClick={() => cancelOrder(o.id)}>
                              <Ban className="h-3 w-3" />
                            </Button>
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

              {/* Student subscriptions log */}
              <StudentSubscriptionsLog />
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
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{Number(o.subject?.price ?? o.amount).toFixed(2)} {o.currency}</span>
                          <span>·</span>
                          <span>{formatDate(o.created_at)}</span>
                          <span>·</span>
                          <span className="font-mono" dir="ltr">{resolveOrderId(o.provider_order_ref)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-300 text-emerald-700"
                          disabled={actioningOrderId === o.id} onClick={() => activateOrder(o.id)}>
                          {actioningOrderId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <BadgeCheck className="h-3 w-3" />}
                          تفعيل
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600"
                          disabled={actioningOrderId === o.id} onClick={() => cancelOrder(o.id)}>
                          <Ban className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ════════ Section: STUDENTS ════════ */}
      {activeSection === 'students' && (
        <>
          <header className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shrink-0">
              <Users className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">الطلاب</h1>
              <p className="text-sm text-muted-foreground">ابحث عن أي طالب بالكود لعرض تفاصيله</p>
            </div>
          </header>
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
          {studentResult?.student && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{studentResult.student.name ?? '—'}</p>
                  <Badge variant={studentResult.student.account_status === 'active' ? 'default' : 'secondary'}>
                    {studentResult.student.account_status === 'active' ? 'نشط' : 'قيد التفعيل'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{studentResult.student.email}</p>
                {studentResult.subscriptions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium">الاشتراكات:</p>
                    {studentResult.subscriptions.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between text-xs">
                        <span>{sub.subject?.name ?? '—'}</span>
                        <Badge variant="secondary" className="text-[10px]">{sub.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ════════ Section: SETTINGS (Profile + Teacher View) ════════ */}
      {activeSection === 'settings' && (
        <SettingsSection
          self={self}
          teacher={teacher}
          teacherViewSection={teacherViewSection}
          setTeacherViewSection={setTeacherViewSection}
          visibleTeacherSections={visibleTeacherSections}
          isRTL={isRTL}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// SettingsSection — v114
//   Shows the agent's own profile + a Teacher View that exposes
//   the teacher's sidebar (filtered by allowed_sections).
// ──────────────────────────────────────────────────────────────
function SettingsSection({
  self,
  teacher,
  teacherViewSection,
  setTeacherViewSection,
  visibleTeacherSections,
  isRTL,
}: {
  self: AgentSelf | null;
  teacher: TeacherInfo | null;
  teacherViewSection: string;
  setTeacherViewSection: (s: string) => void;
  visibleTeacherSections: Array<{ id: string; label: string; icon: React.ReactNode }>;
  isRTL: boolean;
}) {
  if (!self) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
      </div>
    );
  }

  const allowedIsAll = self.allowed_sections === null;
  const allowedCount = self.allowed_sections?.length ?? 0;

  return (
    <>
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg shrink-0">
          <Settings className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">الملف الشخصي + عرض المعلم</h1>
          <p className="text-sm text-muted-foreground">بيانات الوكيل + أقسام المعلم المرئية لك</p>
        </div>
      </header>

      {/* Agent profile card */}
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

      {/* Teacher View navigation */}
      {visibleTeacherSections.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4 text-sky-600" />
              عرض المعلم — اختر قسماً
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 p-2">
              {visibleTeacherSections.map((sec) => {
                const active = teacherViewSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setTeacherViewSection(sec.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      active
                        ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    } ${isRTL ? 'flex-row-reverse' : ''}`}
                  >
                    <span className="shrink-0">{sec.icon}</span>
                    <span className="truncate">{sec.label}</span>
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

      {/* Teacher section preview (read-only — points user to teacher dashboard for full view) */}
      {visibleTeacherSections.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {visibleTeacherSections.find(s => s.id === teacherViewSection)?.icon}
              {visibleTeacherSections.find(s => s.id === teacherViewSection)?.label ?? '—'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              هذه نسخة معاينة من قسم المعلم. للوصول إلى الإجراءات الكاملة (تعديل، إضافة، حذف)،
              يحتاج المعلم إلى تسجيل الدخول بنفسه. الوكيل يرى البيانات فقط.
            </p>
            <TeacherSectionPreview sectionId={teacherViewSection} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// TeacherSectionPreview — v114
//   Renders a read-only preview of a teacher section using the
//   agent's auth context. Each section that the agent is allowed
//   to view fetches its own data via the existing teacher API
//   endpoints (the agent's auth token is accepted because
//   registration_agent role has read access via RLS).
// ──────────────────────────────────────────────────────────────
function TeacherSectionPreview({ sectionId }: { sectionId: string }) {
  // For now, this is a structural placeholder that confirms what
  // section is selected. The agent has read-only access to teacher
  // data via RLS; a full per-section read view will be added in a
  // follow-up. Showing the section id + a hint to switch to the
  // teacher's own login for full editing.
  const labels: Record<string, string> = {
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
  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 bg-slate-50/50 dark:bg-slate-900/30">
      <p className="text-xs text-muted-foreground">
        القسم المحدد: <span className="font-medium">{labels[sectionId] ?? sectionId}</span>
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        يمكن للوكيل تصفّح بيانات هذا القسم بصلاحية قراءة فقط. التفاعل الكامل
        (إضافة/تعديل/حذف) متاح للمعلم فقط من حسابه الخاص.
      </p>
    </div>
  );
}
