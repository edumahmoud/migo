'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  BarChart3,
  TrendingUp,
  Calendar,
  Users,
  Building2,
  Search,
  Check,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

declare global {
  // Browser navigator.clipboard is widely available; type augmentation for safety.
  interface Clipboard {
    writeText: (data: string) => Promise<void>;
  }
}

interface CourseLite {
  id: string;
  name: string;
  join_code: string | null;
  is_paused: boolean;
  level: string | null;
  sub_level: string | null;
}

interface EnrollmentResultItem {
  subjectId: string;
  subjectName: string;
  enrollmentId: string | null;
  alreadyEnrolled: boolean;
  error: string | null;
}

interface RegistrationResult {
  success: true;
  studentId: string;
  studentEmail: string;
  studentName: string;
  studentCode: string;
  temporaryPassword: string | null;
  newlyCreated: boolean;
  enrollments: EnrollmentResultItem[];
  summary: {
    totalRequested: number;
    totalSucceeded: number;
    totalAlreadyEnrolled: number;
    totalFailed: number;
  };
  agent?: { id: string; agentName: string | null; sourceId: string | null; sourceName: string | null } | null;
  enrolledAt: string;
  // legacy single-enrollment field (kept for backward compat):
  enrollment?: EnrollmentResultItem extends never ? never : {
    id: string | null;
    subjectId: string;
    subjectName: string;
    sourceId: string | null;
    sourceName: string | null;
    agentId: string;
    agentName?: string | null;
    enrolledAt: string;
  } | null;
  alreadyEnrolled: boolean;
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

interface DashboardData {
  success: boolean;
  totals: { total_registrations: number; total_unique_students: number; total_courses: number };
  per_course: Array<{ subject_id: string; subject_name: string; level: string | null; sub_level: string | null; students_count: number }>;
  per_month: Array<{ month: string; count: number }>;
  recent: Array<{ id: string; student_id: string; student_name: string | null; student_email: string | null; student_code: string | null; subject_id: string; subject_name: string | null; enrolled_at: string }>;
}

export default function AgentPortal() {
  const { t } = useTranslations();

  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [past, setPast] = useState<PastRegistration[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [form, setForm] = useState({
    studentEmail: '',
    studentName: '',
    studentPhone: '',
    subjectIds: [] as string[],
  });
  const [courseSearch, setCourseSearch] = useState('');
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const authHeaders = await getCachedAuthHeaders();
      const [coursesRes, pastRes, dashRes] = await Promise.all([
        fetch('/api/agent/courses', { headers: authHeaders }),
        fetch('/api/agent/registrations', { headers: authHeaders }),
        fetch('/api/agent/dashboard', { headers: authHeaders }),
      ]);
      const coursesJson = await coursesRes.json();
      const pastJson = await pastRes.json();
      const dashJson = await dashRes.json();
      if (coursesJson.success) setCourses(coursesJson.courses ?? []);
      else toast.error(coursesJson.error || t('common.unexpectedError'));
      if (pastJson.success) setPast(pastJson.registrations ?? []);
      if (dashJson.success) setDashboard(dashJson as DashboardData);
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoadingMeta(false);
    }
  }, [t]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const filteredCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) => {
      const inName = c.name.toLowerCase().includes(q);
      const inLevel = (c.level ?? '').toLowerCase().includes(q);
      const inSubLevel = (c.sub_level ?? '').toLowerCase().includes(q);
      const inCode = (c.join_code ?? '').toLowerCase().includes(q);
      return inName || inLevel || inSubLevel || inCode;
    });
  }, [courses, courseSearch]);

  const selectedCourses = useMemo(
    () => courses.filter((c) => form.subjectIds.includes(c.id)),
    [courses, form.subjectIds]
  );

  const toggleCourse = (id: string) => {
    setForm((prev) =>
      prev.subjectIds.includes(id)
        ? { ...prev, subjectIds: prev.subjectIds.filter((x) => x !== id) }
        : { ...prev, subjectIds: [...prev.subjectIds, id] }
    );
  };

  const submit = async () => {
    if (form.subjectIds.length === 0) {
      toast.error('اختر مقرراً واحداً على الأقل');
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
          subjectIds: form.subjectIds,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      setResult(json as RegistrationResult);
      const s = (json as RegistrationResult).summary;
      toast.success(
        json.newlyCreated
          ? `تم إنشاء حساب الطالب وتسجيله في ${s.totalSucceeded} مقرر`
          : `تم تسجيل الطالب في ${s.totalSucceeded} مقرر${s.totalAlreadyEnrolled ? ` (${s.totalAlreadyEnrolled} كان مسجلاً بهما)` : ''}`
      );
      setForm({ studentEmail: '', studentName: '', studentPhone: '', subjectIds: [] });
      setCourseSearch('');
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
    <div className="space-y-6 p-3 sm:p-6 max-w-6xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg">
          <UserPlus className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">بوابة الوكيل</h1>
          <p className="text-sm text-muted-foreground">
            يمكنك تسجيل الطلاب في دورات المعلم ومتابعة نتائجك.
          </p>
        </div>
      </header>

      {/* Agent financial dashboard */}
      {loadingMeta ? (
        <Card>
          <CardContent className="py-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>جاري تحميل اللوحة...</span>
          </CardContent>
        </Card>
      ) : dashboard ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            لوحة النتائج
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <Card className="border-sky-200 bg-sky-50/40">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">إجمالي تسجيلاتي</span>
                  <TrendingUp className="h-4 w-4 text-sky-600" />
                </div>
                <div className="text-2xl font-bold text-sky-700">
                  {dashboard.totals.total_registrations}
                </div>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">طلاب فريدون</span>
                  <Users className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-bold text-emerald-700">
                  {dashboard.totals.total_unique_students}
                </div>
              </CardContent>
            </Card>
            <Card className="border-purple-200 bg-purple-50/40">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">دورات نشِط فيها</span>
                  <Building2 className="h-4 w-4 text-purple-600" />
                </div>
                <div className="text-2xl font-bold text-purple-700">
                  {dashboard.totals.total_courses}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Per-course mini-table */}
          {dashboard.per_course.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1">
                  <BookOpen className="h-4 w-4" />
                  التسجيلات حسب الدورة
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr className="text-muted-foreground border-b">
                        <th className="py-2 px-3 text-start">الدورة</th>
                        <th className="py-2 px-3 text-start">المستوى</th>
                        <th className="py-2 px-3 text-end">عدد الطلاب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.per_course
                        .sort((a, b) => b.students_count - a.students_count)
                        .map((c) => (
                          <tr key={c.subject_id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2 px-3">{c.subject_name}</td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {[c.level, c.sub_level].filter(Boolean).join(' / ') || '—'}
                            </td>
                            <td className="py-2 px-3 text-end font-mono font-semibold">
                              {c.students_count}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Monthly bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                التسجيلات الشهرية (12 شهر)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1 h-24 border-b border-muted">
                {dashboard.per_month.map((m) => {
                  const maxCount = Math.max(1, ...dashboard.per_month.map((x) => x.count));
                  const height = Math.max(2, (m.count / maxCount) * 90);
                  return (
                    <div
                      key={m.month}
                      className="flex-1 flex flex-col items-center justify-end gap-1"
                      title={`${m.month}: ${m.count}`}
                    >
                      <div
                        className="w-full bg-gradient-to-t from-sky-600 to-teal-400 rounded-t-sm"
                        style={{ height: `${height}%` }}
                      />
                      <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                        {m.month.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Register form + result */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
              <div className="flex items-center justify-between">
                <Label>المقررات</Label>
                <span className="text-xs text-muted-foreground">
                  {form.subjectIds.length} مُحدّد
                </span>
              </div>
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
                <div className="space-y-2">
                  {/* Selected courses as removable badges */}
                  {selectedCourses.length > 0 && (
                    <div className="flex flex-wrap gap-1 p-2 bg-muted/40 rounded-md border border-input">
                      {selectedCourses.map((c) => (
                        <Badge
                          key={c.id}
                          variant="default"
                          className="text-xs gap-1 pr-1"
                        >
                          <span className="truncate max-w-[180px]">{c.name}</span>
                          <button
                            type="button"
                            onClick={() => toggleCourse(c.id)}
                            className="ms-1 rounded-full hover:bg-foreground/20 p-0.5"
                            aria-label="إزالة"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Searchable multi-select popover */}
                  <Popover open={coursesOpen} onOpenChange={setCoursesOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                      >
                        <span className="flex items-center gap-2">
                          <Search className="h-4 w-4 text-muted-foreground" />
                          {form.subjectIds.length === 0
                            ? 'ابحث واختر المقررات...'
                            : `${form.subjectIds.length} مقرر مُحدّد`}
                        </span>
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="ابحث باسم المقرر أو الفرقة..."
                          value={courseSearch}
                          onValueChange={setCourseSearch}
                        />
                        <CommandList>
                          <CommandEmpty>
                            {courses.length === 0
                              ? 'لا توجد مقررات.'
                              : 'لا توجد نتائج مطابقة.'}
                          </CommandEmpty>
                          <CommandGroup>
                            {filteredCourses.map((c) => {
                              const meta: string[] = [];
                              if (c.level) meta.push(c.level);
                              if (c.sub_level) meta.push(c.sub_level);
                              const isSelected = form.subjectIds.includes(c.id);
                              return (
                                <CommandItem
                                  key={c.id}
                                  value={c.id}
                                  onSelect={() => toggleCourse(c.id)}
                                  disabled={c.is_paused}
                                  className="gap-2"
                                >
                                  <div
                                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                                      isSelected
                                        ? 'bg-primary border-primary text-primary-foreground'
                                        : 'border-muted-foreground/40'
                                    }`}
                                  >
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="font-medium truncate">{c.name}</span>
                                      {meta.length > 0 && (
                                        <span className="text-xs text-muted-foreground">
                                          · {meta.join(' / ')}
                                        </span>
                                      )}
                                      {c.is_paused && (
                                        <span className="text-xs text-amber-600">· ⏸ متوقفة</span>
                                      )}
                                    </div>
                                    {c.join_code && (
                                      <div className="text-[10px] text-muted-foreground font-mono">
                                        كود: {c.join_code}
                                      </div>
                                    )}
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <div className="flex gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, subjectIds: filteredCourses.filter((c) => !c.is_paused).map((c) => c.id) })}
                      className="text-sky-600 hover:underline"
                      disabled={filteredCourses.length === 0}
                    >
                      تحديد الكل
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, subjectIds: [] })}
                      className="text-red-600 hover:underline"
                      disabled={form.subjectIds.length === 0}
                    >
                      مسح التحديد
                    </button>
                  </div>
                </div>
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
              disabled={saving || loadingMeta || courses.length === 0 || form.subjectIds.length === 0}
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
                    {result.newlyCreated
                      ? 'تم إنشاء حساب الطالب وتسجيله في المقررات المحدّدة.'
                      : 'تم إعادة استخدام حساب الطالب وتسجيله في المقررات المحدّدة.'}
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
                      <span>كلمة المرور المؤقتة تظهر مرة واحدة فقط. أعطها للطالب الآن.</span>
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
                  {/* Summary line */}
                  <div className="flex items-center gap-3 text-xs rounded-md bg-sky-50 border border-sky-200 p-2">
                    <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
                    <span className="text-sky-900">
                      طُلِبَ {result.summary.totalRequested} مقرر · نجح {result.summary.totalSucceeded}
                      {result.summary.totalAlreadyEnrolled > 0 && ` · ${result.summary.totalAlreadyEnrolled} كان مسجّلاً مسبقاً`}
                      {result.summary.totalFailed > 0 && ` · فشل ${result.summary.totalFailed}`}
                    </span>
                  </div>

                  {/* Enrollments list (one row per course) */}
                  <div>
                    <Label>المقررات المسجّلة</Label>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {result.enrollments.map((e) => (
                        <div
                          key={e.subjectId}
                          className={`flex items-center justify-between text-sm rounded-md px-2 py-1.5 border ${
                            e.error
                              ? 'bg-red-50 border-red-200'
                              : e.alreadyEnrolled
                              ? 'bg-amber-50 border-amber-200'
                              : 'bg-emerald-50 border-emerald-200'
                          }`}
                        >
                          <span className="truncate font-medium">{e.subjectName}</span>
                          <span className="text-xs shrink-0 ms-2">
                            {e.error ? (
                              <span className="text-red-700">⚠ فشل</span>
                            ) : e.alreadyEnrolled ? (
                              <span className="text-amber-700">كان مسجّلاً</span>
                            ) : (
                              <span className="text-emerald-700">✓ تم</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label>الوكيل</Label>
                    <div>{result.agent?.agentName ?? result.agent?.sourceName ?? '—'}</div>
                  </div>
                  <div>
                    <Label>تاريخ التسجيل</Label>
                    <div>{new Date(result.enrolledAt).toLocaleString()}</div>
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
                      <td className="py-2 px-2">
                        {r.enrolled_at ? new Date(r.enrolled_at).toLocaleString() : '—'}
                      </td>
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
