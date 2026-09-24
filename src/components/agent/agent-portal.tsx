'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2,
  Mail,
  User,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Copy,
  KeyRound,
  UserPlus,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

// ------------------------------------
// Types (local)
// ------------------------------------
interface CourseLite {
  id: string;
  name: string;
  join_code: string | null;
  is_paused: boolean;
  level: string | null;
  sub_level: string | null;
}

interface RegistrationResult {
  success: true;
  studentId: string;
  studentEmail: string;
  studentName: string;
  studentCode: string;
  temporaryPassword: string | null;
  newlyCreated: boolean;
  alreadyEnrolled: boolean;
  enrollment: {
    id: string;
    subjectId: string;
    subjectName: string;
    sourceId: string;
    sourceName: string | null;
    agentId: string;
    enrolledAt: string;
  };
}

interface PastRegistration {
  id: string;
  subject_id: string;
  student_id: string;
  status: string;
  enrollment_method: string;
  enrolled_at: string;
  subject?: { id: string; name: string; join_code: string | null } | null;
  student?: { id: string; email: string; name: string | null; student_code: string | null } | null;
}

export default function AgentPortal() {
  const { t } = useTranslations();

  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [past, setPast] = useState<PastRegistration[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [form, setForm] = useState({
    studentEmail: '',
    studentName: '',
    studentPhone: '',
    subjectId: '',
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const authHeaders = await getCachedAuthHeaders();
      const [coursesRes, pastRes] = await Promise.all([
        fetch('/api/agent/courses', { headers: authHeaders }),
        fetch('/api/agent/registrations', { headers: authHeaders }),
      ]);
      const coursesJson = await coursesRes.json();
      const pastJson = await pastRes.json();
      if (coursesJson.success) setCourses(coursesJson.courses ?? []);
      else toast.error(coursesJson.error || t('common.unexpectedError'));
      if (pastJson.success) setPast(pastJson.registrations ?? []);
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoadingMeta(false);
    }
  }, [t]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const submit = async () => {
    if (!form.subjectId) {
      toast.error('اختر الدورة');
      return;
    }
    if (!form.studentEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.studentEmail)) {
      toast.error('أدخل بريداً إلكترونياً صحيحاً');
      return;
    }
    if (!form.studentName.trim()) {
      toast.error('أدخل اسم الطالب');
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/agent/register-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          studentEmail: form.studentEmail.trim(),
          studentName: form.studentName.trim(),
          studentPhone: form.studentPhone.trim() || undefined,
          subjectId: form.subjectId,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      setResult(json as RegistrationResult);
      toast.success(
        json.alreadyEnrolled
          ? 'الطالب مسجّل بالفعل في الدورة'
          : json.newlyCreated
          ? 'تم إنشاء حساب الطالب وتسجيله في الدورة'
          : 'تم تسجيل الطالب في الدورة'
      );
      setForm({ studentEmail: '', studentName: '', studentPhone: '', subjectId: '' });
      await loadMeta();
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error('تعذر النسخ');
    }
  };

  return (
    <div className="space-y-6 p-3 sm:p-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg">
          <UserPlus className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">بوابة تسجيل الطلاب</h1>
          <p className="text-sm text-muted-foreground">
            يمكنك تسجيل طلاب في دورات معلمك فقط.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* The registration form */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-sky-600" />
              تسجيل طالب جديد
            </CardTitle>
            <CardDescription>
              أدخل بيانات الطالب والدورة. إذا كان لديه حساب بالفعل سيتم إعادة استخدامه.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>الدورة</Label>
              {loadingMeta ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التحميل...
                </div>
              ) : courses.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  لا توجد دورات متاحة لك. تواصل مع المعلم.
                </div>
              ) : (
                <Select
                  value={form.subjectId}
                  onValueChange={(v) => setForm({ ...form, subjectId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الدورة" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => {
                      const meta: string[] = [];
                      if (c.level) meta.push(c.level);
                      if (c.sub_level) meta.push(c.sub_level);
                      const metaLabel = meta.length > 0 ? ` · ${meta.join(' / ')}` : '';
                      const statusLabel = c.is_paused ? ' · ⏸ متوقفة' : '';
                      return (
                        <SelectItem key={c.id} value={c.id} disabled={c.is_paused}>
                          <span className="font-medium">{c.name}</span>
                          {metaLabel && (
                            <span className="text-muted-foreground">{metaLabel}</span>
                          )}
                          {statusLabel && (
                            <span className="text-amber-600">{statusLabel}</span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="ag-student-name">اسم الطالب</Label>
              <div className="relative">
                <Input
                  id="ag-student-name"
                  value={form.studentName}
                  onChange={(e) => setForm({ ...form, studentName: e.target.value })}
                  maxLength={120}
                  className="ps-10"
                  placeholder="الاسم الكامل"
                />
                <User className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ag-student-email">بريد الطالب الإلكتروني</Label>
              <div className="relative">
                <Input
                  id="ag-student-email"
                  type="email"
                  value={form.studentEmail}
                  onChange={(e) => setForm({ ...form, studentEmail: e.target.value })}
                  maxLength={254}
                  className="ps-10"
                  placeholder="example@domain.com"
                  dir="ltr"
                />
                <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ag-student-phone">رقم الهاتف (اختياري)</Label>
              <Input
                id="ag-student-phone"
                value={form.studentPhone}
                onChange={(e) => setForm({ ...form, studentPhone: e.target.value })}
                maxLength={40}
                dir="ltr"
              />
            </div>

            <Button
              onClick={submit}
              disabled={saving || loadingMeta || courses.length === 0}
              className="w-full h-11 bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700"
            >
              {saving ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin me-2" />
                  جاري التسجيل...
                </>
              ) : (
                <>
                  <UserPlus className="h-5 w-5 me-2" />
                  تسجيل الطالب
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Result card */}
        <div>
          {result ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="border-sky-200 bg-sky-50/50 shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sky-700">
                    <CheckCircle2 className="h-5 w-5" />
                    تم التسجيل بنجاح
                  </CardTitle>
                  <CardDescription>
                    {result.alreadyEnrolled
                      ? 'الطالب كان مسجلاً بالفعل — تم إعادة عرض البيانات.'
                      : result.newlyCreated
                      ? 'تم إنشاء حساب الطالب وتسجيله في الدورة.'
                      : 'تم إعادة استخدام حساب الطالب وتسجيله في الدورة.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <Label>اسم الطالب</Label>
                    <div>{result.studentName}</div>
                  </div>
                  <div>
                    <Label>البريد الإلكتروني</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted px-2 py-1 rounded" dir="ltr">
                        {result.studentEmail}
                      </code>
                      <Button size="icon" variant="ghost" onClick={() => copy(result.studentEmail, 'البريد')}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>كود الطالب</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-base bg-muted px-2 py-1 rounded tracking-widest">
                        {result.studentCode}
                      </code>
                      <Button size="icon" variant="ghost" onClick={() => copy(result.studentCode, 'كود الطالب')}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {result.temporaryPassword && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>
                        كلمة المرور المؤقتة تظهر مرة واحدة فقط. أعطها للطالب الآن.
                      </span>
                    </div>
                  )}
                  {result.temporaryPassword && (
                    <div>
                      <Label>كلمة المرور المؤقتة</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-base bg-amber-100 border border-amber-300 px-2 py-1 rounded tracking-widest">
                          {result.temporaryPassword}
                        </code>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => copy(result.temporaryPassword ?? '', 'كلمة المرور')}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div>
                    <Label>الدورة</Label>
                    <div>{result.enrollment.subjectName}</div>
                  </div>
                  <div>
                    <Label>مصدر التسجيل</Label>
                    <div>{result.enrollment.sourceName ?? '—'}</div>
                  </div>
                  <div>
                    <Label>تاريخ التسجيل</Label>
                    <div>{new Date(result.enrollment.enrolledAt).toLocaleString()}</div>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => setResult(null)}>
                    <UserPlus className="h-4 w-4 me-2" />
                    تسجيل طالب آخر
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-muted-foreground space-y-3">
                <KeyRound className="h-10 w-10 mx-auto opacity-30" />
                <p>سيظهر هنا كود الطالب وكلمة المرور المؤقتة بعد التسجيل.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Past registrations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-sky-600" />
            تسجيلاتي الأخيرة
          </CardTitle>
          <CardDescription>آخر 200 تسجيل قمت بها.</CardDescription>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              لا توجد تسجيلات بعد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-muted-foreground border-b">
                    <th className="py-2 px-2 text-start">الطالب</th>
                    <th className="py-2 px-2 text-start">البريد</th>
                    <th className="py-2 px-2 text-start">كود الطالب</th>
                    <th className="py-2 px-2 text-start">الدورة</th>
                    <th className="py-2 px-2 text-start">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 px-2">{r.student?.name ?? '—'}</td>
                      <td className="py-2 px-2" dir="ltr">{r.student?.email ?? '—'}</td>
                      <td className="py-2 px-2 font-mono">{r.student?.student_code ?? '—'}</td>
                      <td className="py-2 px-2">{r.subject?.name ?? '—'}</td>
                      <td className="py-2 px-2">{r.enrolled_at ? new Date(r.enrolled_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
