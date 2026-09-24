'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Loader2, KeyRound, Copy, Link as LinkIcon, BookOpen, CreditCard,
  CheckCircle2, AlertCircle, RefreshCw, LogOut, Wallet, Check, X,
  Contact, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import { supabase } from '@/lib/supabase';

interface AvailableCourse {
  id: string; name: string; description: string | null;
  level: string | null; sub_level: string | null;
  price: number; currency: string; teacher_name: string | null;
}
interface OrderRow {
  id: string; subject_id: string; amount: number; currency: string;
  provider: string; status: string; confirmation_mode: string;
  created_at: string; paid_at: string | null;
}
interface Subscription {
  subject_id: string; status: string; enrollment_method: string;
  current_period_start: string | null; current_period_end: string | null;
  next_billing_at: string | null; monthly_price: number | null; enrolled_at: string;
}
interface PaymentMethod {
  id: string; name: string; icon: string;
  account_identifier: string; contact_for_confirmation: string | null;
  requires_manual_approval: boolean;
}
interface ActivationData {
  student: { id: string; email: string; name: string | null; student_code: string | null; account_status: string };
  linked_teachers: Array<{ teacher: { id: string; name: string | null; email: string; teacher_code: string } | null; status: string }>;
  available_courses: AvailableCourse[];
  recent_orders: OrderRow[];
  subscriptions: Subscription[];
}

const ICON_MAP: Record<string, string> = { wallet: '👛', credit_card: '💳', banknote: '💵', smartphone: '📱', building: '🏦', landmark: '🏛️', repeat: '🔁' };

export default function StudentActivationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut, user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [data, setData] = useState<ActivationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [teacherCode, setTeacherCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState<{ methods: PaymentMethod[]; orders: OrderRow[]; mode: string; checkoutUrl: string | null } | null>(null);

  const studentId = user?.id;

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
  useEffect(() => {
    if (!studentId) return;

    const channel = supabase
      .channel('activation-realtime')
      // Watch orders table: when an order status changes (e.g., supervisor
      // approves → status='paid'), reload to show updated pending list.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `student_id=eq.${studentId}` },
        () => { load(); }
      )
      // Watch subject_students: when a new enrollment is created or updated
      // (e.g., supervisor activates → new row with status='approved'), reload.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subject_students', filter: `student_id=eq.${studentId}` },
        () => { load(); }
      )
      // Watch users: when account_status changes from 'pending' to 'active',
      // reload → the load() function will detect 'active' and redirect.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${studentId}` },
        () => { load(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId, load]);

  const handleLinkTeacher = async () => {
    if (!teacherCode.trim()) { toast.error('أدخل كود المعلم'); return; }
    setLinking(true);
    try {
      const res = await fetch('/api/student/activation/link-teacher', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ teacherCode: teacherCode.trim() }),
      });
      const json = await res.json();
      if (json.success) { toast.success(`تم الربط بـ ${json.teacher?.name ?? 'المعلم'}`); setTeacherCode(''); await load(); }
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
        await load();
        if (json.payment_methods?.length > 0 || json.created_orders?.length > 0) {
          setPaymentDialog({
            methods: json.payment_methods ?? [],
            orders: json.created_orders ?? [],
            mode: json.confirmation_mode ?? 'manual',
            checkoutUrl: json.checkout_url ?? null,
          });
        }
        toast.success(json.message || 'تم إنشاء الطلبات');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50 p-3 sm:p-6">
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
              {pendingOrders.map(o => (
                <div key={o.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{courseNameById.get(o.subject_id) ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString('ar-EG')}</div>
                  </div>
                  <div className="text-end shrink-0 flex items-center gap-2">
                    <span className="font-mono text-xs">{Number(o.amount).toFixed(2)} {o.currency}</span>
                    <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 me-1" />قيد الدفع</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Payment methods dialog */}
      <Dialog open={!!paymentDialog} onOpenChange={o => !o && setPaymentDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-sky-600" />وسائل الدفع</DialogTitle>
            <DialogDescription>قم بالتحويل عبر إحدى الوسائل التالية، ثم أرسل إثبات الدفع للمركز لتفعيل اشتراكك.</DialogDescription>
          </DialogHeader>
          {paymentDialog && (
            <div className="space-y-2">
              {paymentDialog.methods.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-4">لا توجد وسائل دفع مُهيأة لهذا المعلم. تواصل معه مباشرة.</div>
              ) : (
                paymentDialog.methods.map((m, i) => (
                  <div key={i} className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <span className="text-xl">{ICON_MAP[m.icon] ?? m.icon ?? '👛'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mono text-sm bg-white/20 px-2 py-1 rounded" dir="ltr">{m.account_identifier}</code>
                      <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 h-8 w-8" onClick={() => copy(m.account_identifier, 'رقم الحساب')}><Copy className="h-4 w-4" /></Button>
                    </div>
                    {m.contact_for_confirmation && (
                      <div className="flex items-center gap-2 text-xs bg-white/20 rounded px-2 py-1">
                        <Contact className="h-3 w-3" />
                        <span>للتأكيد: {m.contact_for_confirmation}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
              <div className="rounded-md bg-sky-50 border border-sky-200 text-sky-900 text-xs p-3">
                ✓ بعد إتمام التحويل وإرسال الإثبات، سيقوم المركز بتفعيل اشتراكك. ستختفي المقررات من قائمة "قيد الدفع" ويظهر اشتراكك نشطاً.
              </div>
              {paymentDialog.checkoutUrl && (
                <Button className="w-full" onClick={() => { window.location.href = paymentDialog.checkoutUrl!; }}>
                  الدفع عبر البوابة (تجريبي)
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>تم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
