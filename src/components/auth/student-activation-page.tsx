'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Loader2,
  KeyRound,
  Copy,
  Link as LinkIcon,
  BookOpen,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Wallet,
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

interface AvailableCourse {
  id: string;
  name: string;
  description: string | null;
  level: string | null;
  sub_level: string | null;
  price: number;
  currency: string;
  teacher_name: string | null;
}

interface LinkedTeacher {
  teacher: { id: string; name: string | null; email: string; teacher_code: string } | null;
  status: string;
}

interface OrderRow {
  id: string;
  subject_id: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  confirmation_mode: string;
  created_at: string;
  paid_at: string | null;
}

interface Subscription {
  subject_id: string;
  status: string;
  enrollment_method: string;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  monthly_price: number | null;
  enrolled_at: string;
}

interface ActivationData {
  student: { id: string; email: string; name: string | null; student_code: string | null; account_status: string };
  linked_teachers: LinkedTeacher[];
  available_courses: AvailableCourse[];
  recent_orders: OrderRow[];
  subscriptions: Subscription[];
}

export default function StudentActivationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [data, setData] = useState<ActivationData | null>(null);
  const [loading, setLoading] = useState(true);

  const [teacherCode, setTeacherCode] = useState('');
  const [linking, setLinking] = useState(false);

  const [payingCourseId, setPayingCourseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/student/activation/me', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        setData(json as ActivationData);
        // If student became ACTIVE, redirect to dashboard.
        if ((json as ActivationData).student.account_status === 'active') {
          toast.success('تم تفعيل حسابك! جارٍ فتح المنصة...');
          setTimeout(() => router.push('/'), 1500);
        }
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [t, router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleLinkTeacher = async () => {
    if (!teacherCode.trim()) {
      toast.error('أدخل كود المعلم');
      return;
    }
    setLinking(true);
    try {
      const res = await fetch('/api/student/activation/link-teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ teacherCode: teacherCode.trim() }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success(`تم الربط بـ ${json.teacher?.name ?? 'المعلم'}`);
        setTeacherCode('');
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLinking(false);
    }
  };

  const handlePay = async (course: AvailableCourse) => {
    setPayingCourseId(course.id);
    try {
      const res = await fetch('/api/student/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ subjectId: course.id, provider: 'mock' }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      // Redirect to the mock checkout (in production: real gateway URL).
      if (json.checkout_url) {
        // router.push would re-render in-app; we need a full page navigation
        // to the gateway's hosted checkout. Use a hidden <a> + click.
        const a = document.createElement('a');
        a.href = json.checkout_url;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setPayingCourseId(null);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error('تعذّر النسخ');
    }
  };

  const handleSignOut = () => {
    resetAppStore();
    try { signOut(); } catch {}
    router.push('/');
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-teal-50">
        <div className="flex items-center gap-2 text-sky-700">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>جارٍ تحميل صفحة التفعيل...</span>
        </div>
      </div>
    );
  }

  const studentCode = data.student.student_code ?? '—';
  const linkedTeachers = data.linked_teachers;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50 p-3 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg">
              <KeyRound className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">تفعيل الحساب</h1>
              <p className="text-sm text-muted-foreground">
                {data.student.name ?? data.student.email}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 me-1" />
            تسجيل الخروج
          </Button>
        </motion.div>

        {/* Pending notice */}
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold mb-1">حسابك قيد التفعيل</p>
              <p className="text-xs">
                لتفعيل حسابك والوصول للمنصة: اربط نفسك بمعلم ← اختر مقرراً ← ادفع رسومه.
                بعد تأكيد الدفع، يتم تفعيل اشتراكك وحسابك تلقائياً.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Student Code */}
        <Card className="border-sky-200 bg-sky-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-sky-600" />
              كود الطالب
            </CardTitle>
            <CardDescription className="text-xs">
              احتفظ بهذا الكود — قد تحتاجه للدعم الفني.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-2xl tracking-widest bg-white border border-sky-200 px-3 py-2 rounded text-center">
                {studentCode}
              </code>
              <Button
                size="icon"
                variant="outline"
                onClick={() => copy(studentCode, 'كود الطالب')}
                title="نسخ"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Teacher Code linking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-sky-600" />
              الربط مع المعلم
            </CardTitle>
            <CardDescription className="text-xs">
              أدخل كود المعلم (تجده عند معلمك).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={teacherCode}
                onChange={(e) => setTeacherCode(e.target.value.toUpperCase())}
                placeholder="مثال: A1B2C3"
                dir="ltr"
                maxLength={40}
                className="font-mono tracking-widest"
                disabled={linking}
              />
              <Button onClick={handleLinkTeacher} disabled={linking || !teacherCode.trim()}>
                {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                ربط
              </Button>
            </div>
            {linkedTeachers.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">المعلمون المرتبطون:</div>
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

        {/* Available courses */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-sky-600" />
                المقررات المتاحة
              </CardTitle>
              <CardDescription className="text-xs">
                الاشتراك شهري — ادفع رسوم شهر واحد للحصول على وصول كامل حتى نهاية الفترة. يمكنك التجديد في أي وقت.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={load} title="تحديث">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {linkedTeachers.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">
                اربط نفسك بمعلم أولاً لرؤية المقررات المتاحة.
              </div>
            ) : data.available_courses.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">
                لا توجد مقررات متاحة للاشتراك حالياً. تواصل مع معلمك.
              </div>
            ) : (
              data.available_courses.map((c) => {
                const isPaying = payingCourseId === c.id;
                // Find existing subscription for this course.
                const sub = data.subscriptions?.find((s) => s.subject_id === c.id);
                const isSubActive = sub?.current_period_end && new Date(sub.current_period_end) > new Date();
                const isSubExpired = sub?.current_period_end && new Date(sub.current_period_end) <= new Date();
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 border rounded-md p-3 hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {c.teacher_name && <span>· {c.teacher_name}</span>}
                        {(c.level || c.sub_level) && (
                          <span>· {[c.level, c.sub_level].filter(Boolean).join(' / ')}</span>
                        )}
                        {isSubActive && sub?.current_period_end && (
                          <Badge variant="default" className="text-[10px] bg-emerald-600">
                            نشط حتى {new Date(sub.current_period_end).toLocaleDateString('ar-EG')}
                          </Badge>
                        )}
                        {isSubExpired && sub?.current_period_end && (
                          <Badge variant="destructive" className="text-[10px]">
                            منتهي في {new Date(sub.current_period_end).toLocaleDateString('ar-EG')}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="font-bold text-emerald-700">
                        {c.price === 0 ? 'مجاناً' : `${Number(c.price).toFixed(2)} ${c.currency}/شهر`}
                      </div>
                      <Button
                        size="sm"
                        className="mt-1 bg-gradient-to-l from-sky-700 to-teal-600"
                        onClick={() => handlePay(c)}
                        disabled={isPaying}
                      >
                        {isPaying ? (
                          <Loader2 className="h-4 w-4 animate-spin me-1" />
                        ) : (
                          <CreditCard className="h-4 w-4 me-1" />
                        )}
                        {isSubActive ? 'تجديد' : isSubExpired ? 'اشترك من جديد' : c.price === 0 ? 'اشترك مجاناً' : 'اشترك وادفع'}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Recent orders / payment status */}
        {data.recent_orders.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-sky-600" />
                طلبات الدفع الأخيرة
              </CardTitle>
              <CardDescription className="text-xs">
                تابع حالة طلباتك. للدفعات اليدوية (فوري/إنستا باي)، يتم التفعيل بعد تأكيد المعلم/الإدارة.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {data.recent_orders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between text-sm border rounded-md px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <code className="text-xs font-mono" dir="ltr">{o.id.slice(0, 8)}…</code>
                      <div className="text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="font-mono text-xs">
                        {Number(o.amount).toFixed(2)} {o.currency}
                      </div>
                      <Badge
                        variant={
                          o.status === 'paid' ? 'default' :
                          o.status === 'failed' ? 'destructive' :
                          'secondary'
                        }
                        className="text-xs"
                      >
                        {o.status === 'pending' ? 'قيد الدفع' :
                         o.status === 'paid' ? 'مدفوع ✓' :
                         o.status === 'failed' ? 'فشل' : o.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
