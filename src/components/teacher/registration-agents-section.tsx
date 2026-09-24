'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  UserCog,
  Power,
  Check,
  X,
  Copy,
  AlertCircle,
  KeyRound,
  Users,
  Search,
  ChevronDown,
  ChevronLeft,
  Building2,
  Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import RegistrationSourcesSection from './registration-sources-section';

// ------------------------------------
// Types (local)
// ------------------------------------
interface SourceLite {
  id: string;
  name: string;
  kind: string;
  is_active: boolean;
}

interface AgentUser {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
}

interface RegistrationAgent {
  id: string;
  user_id: string;
  source_id: string;
  is_active: boolean;
  created_at: string;
  students_count?: number;
  source?: SourceLite | null;
  user?: AgentUser | null;
}

interface AgentStudent {
  id: string;
  subject_id: string;
  student_id: string;
  status: string;
  enrollment_method: string;
  enrolled_at: string;
  subject?: { id: string; name: string; join_code: string | null; level: string | null; sub_level: string | null; is_paused: boolean } | null;
  student?: { id: string; email: string; name: string | null; student_code: string | null; username: string | null } | null;
}

const KIND_LABEL: Record<string, string> = {
  center: 'المركز الرئيسي',
  external_office: 'مكتب خارجي',
  other: 'أخرى',
};

export default function RegistrationAgentsSection() {
  const { t } = useTranslations();

  const [agents, setAgents] = useState<RegistrationAgent[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ source_id: string; name: string; email: string }>({
    source_id: '',
    name: '',
    email: '',
  });
  const [saving, setSaving] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    tempPassword: string;
    name: string;
  } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<RegistrationAgent | null>(null);

  // Students dialog state
  const [studentsTarget, setStudentsTarget] = useState<RegistrationAgent | null>(null);
  const [studentsList, setStudentsList] = useState<AgentStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/registration-sources', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        const list = (json.sources as Array<{ id: string; name: string; kind: string; is_active: boolean }>).map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          is_active: s.is_active,
        }));
        setSources(list);
        if (list.length > 0 && !form.source_id) {
          setForm((prev) => ({ ...prev, source_id: list[0].id }));
        }
      }
    } catch {
      // ignore — the sources section shows the error.
    }
  }, [form.source_id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher/registration-agents', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        setAgents([]);
      } else {
        setAgents(json.agents as RegistrationAgent[]);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadSources();
    load();
  }, [loadSources, load]);

  // Filter + group agents by source for display
  const filteredAgents = useMemo(() => {
    let list = agents;
    if (sourceFilter !== 'all') {
      list = list.filter((a) => a.source_id === sourceFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => {
        const name = a.user?.name || '';
        const email = a.user?.email || '';
        return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
      });
    }
    return list;
  }, [agents, sourceFilter, search]);

  const groupedBySource = useMemo(() => {
    const map = new Map<string, { source: SourceLite | null; agents: RegistrationAgent[] }>();
    for (const a of filteredAgents) {
      const key = a.source_id;
      if (!map.has(key)) {
        map.set(key, { source: a.source ?? null, agents: [] });
      }
      map.get(key)!.agents.push(a);
    }
    return Array.from(map.values());
  }, [filteredAgents]);

  const openCreate = () => {
    if (sources.length === 0) {
      toast.error('يرجى إنشاء مصدر تسجيل أولاً من قسم "مصادر التسجيل" بالأعلى.');
      return;
    }
    setForm({ source_id: sources[0]?.id ?? '', name: '', email: '' });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!form.source_id) {
      toast.error('اختر مصدر التسجيل');
      return;
    }
    if (!form.name.trim()) {
      toast.error('أدخل اسم الوكيل');
      return;
    }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error('أدخل بريداً إلكترونياً صحيحاً');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/teacher/registration-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم إنشاء وكيل التسجيل');
        setCreateOpen(false);
        setCreatedCreds({
          email: json.user.email,
          tempPassword: json.temporaryPassword,
          name: json.user.name,
        });
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a: RegistrationAgent, next: boolean) => {
    try {
      const res = await fetch(`/api/teacher/registration-agents/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ is_active: next }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      toast.success(next ? 'تم تفعيل الوكيل' : 'تم تعطيل الوكيل');
      await load();
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/teacher/registration-agents/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم حذف الوكيل');
        setDeleteTarget(null);
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const openStudents = async (a: RegistrationAgent) => {
    setStudentsTarget(a);
    setStudentsList([]);
    setStudentsLoading(true);
    try {
      const res = await fetch(`/api/teacher/registration-agents/${a.id}/students`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        setStudentsList(json.students as AgentStudent[]);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setStudentsLoading(false);
    }
  };

  const copyCreds = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error('تعذر النسخ');
    }
  };

  return (
    <div className="space-y-6">
      <RegistrationSourcesSection />

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <UserCog className="h-5 w-5 text-sky-600" />
              وكلاء التسجيل
            </h2>
            <p className="text-sm text-muted-foreground">
              يمكن للوكيل تسجيل الطلاب في دوراتك ضمن مصدره فقط.
            </p>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 me-1" />
            وكيل جديد
          </Button>
        </div>

        {/* Search + filter bar */}
        {!loading && agents.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو البريد..."
                className="ps-10"
              />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="sm:w-64">
                <SelectValue placeholder="كل المصادر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المصادر</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
          </div>
        ) : agents.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <UserCog className="h-10 w-10 mx-auto mb-3 opacity-30" />
              لا يوجد وكلاء تسجيل بعد. اضغط &quot;وكيل جديد&quot; للبدء.
            </CardContent>
          </Card>
        ) : filteredAgents.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              لا توجد نتائج مطابقة للبحث.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groupedBySource.map(({ source, agents: sourceAgents }) => (
              <Card key={source?.id ?? 'unknown'} className="overflow-hidden">
                <CardHeader className="pb-2 bg-sky-50/40 dark:bg-sky-900/10 border-b">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-sky-600" />
                      {source?.name ?? 'مصدر محذوف'}
                      {source && (
                        <Badge variant="outline" className="text-xs">
                          {KIND_LABEL[source.kind] ?? source.kind}
                        </Badge>
                      )}
                      {source?.is_active === false && (
                        <Badge variant="destructive" className="text-xs">المصدر معطّل</Badge>
                      )}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {sourceAgents.length} وكيل
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sourceAgents.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-lg border bg-card p-3 hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold truncate">
                                {a.user?.name ?? '—'}
                              </span>
                              {a.is_active ? (
                                <Badge variant="default" className="text-xs shrink-0">نشط</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs shrink-0">معطّل</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate" dir="ltr">
                              {a.user?.email ?? '—'}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              <span>{a.students_count ?? 0} طالب مسجّل</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-1.5 justify-end flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openStudents(a)}
                            className="text-xs"
                          >
                            <Users className="h-3.5 w-3.5 me-1" />
                            الطلاب
                          </Button>
                          {a.is_active ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => toggleActive(a, false)}
                              className="text-xs"
                              title="إيقاف حساب الوكيل"
                            >
                              <Power className="h-3.5 w-3.5 me-1" />
                              إيقاف
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => toggleActive(a, true)}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700"
                              title="تنشيط حساب الوكيل"
                            >
                              <Power className="h-3.5 w-3.5 me-1" />
                              تنشيط
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(a)}
                            title="حذف"
                            className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create agent dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء وكيل تسجيل جديد</DialogTitle>
            <DialogDescription>
              سيتم إنشاء حساب للوكيل بكلمة مرور مؤقتة — اطبعها أو انسخها للوكيل فوراً.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>مصدر التسجيل</Label>
              <Select
                value={form.source_id}
                onValueChange={(v) => setForm({ ...form, source_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر المصدر" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-name">اسم الوكيل</Label>
              <Input
                id="ra-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-email">البريد الإلكتروني</Label>
              <Input
                id="ra-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                maxLength={254}
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              <X className="h-4 w-4 me-1" />
              إلغاء
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show temp credentials ONCE */}
      <Dialog open={!!createdCreds} onOpenChange={(o) => !o && setCreatedCreds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-sky-600" />
              بيانات دخول الوكيل
            </DialogTitle>
            <DialogDescription>
              هذه هي المرة الوحيدة التي يتم فيها عرض كلمة المرور المؤقتة. انسخها وأعطها للوكيل الآن.
            </DialogDescription>
          </DialogHeader>
          {createdCreds && (
            <div className="space-y-3">
              <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  كلمة المرور لن تُحفظ ولن تظهر مجدداً. إذا فقدتها، ستحتاج إلى تعيين كلمة مرور جديدة
                  للوكيل من إدارة المستخدمين.
                </span>
              </div>
              <div className="space-y-1">
                <Label>الاسم</Label>
                <div className="text-sm">{createdCreds.name}</div>
              </div>
              <div className="space-y-1">
                <Label>البريد الإلكتروني</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-muted px-2 py-1 rounded">{createdCreds.email}</code>
                  <Button size="icon" variant="ghost" onClick={() => copyCreds(createdCreds.email, 'البريد')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label>كلمة المرور المؤقتة</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-base font-mono bg-muted px-2 py-1 rounded tracking-widest">
                    {createdCreds.tempPassword}
                  </code>
                  <Button size="icon" variant="ghost" onClick={() => copyCreds(createdCreds.tempPassword, 'كلمة المرور')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="rounded-md bg-sky-50 border border-sky-200 text-sky-900 text-xs p-3">
                يدخل الوكيل من نفس صفحة تسجيل الدخول بالبريد الإلكتروني وكلمة المرور هذه. سيُطلب منه
                تغيير كلمة المرور بعد أول دخول.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedCreds(null)}>
              <Check className="h-4 w-4 me-1" />
              تم — حفظت البيانات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent students dialog */}
      <Dialog open={!!studentsTarget} onOpenChange={(o) => !o && setStudentsTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-sky-600" />
              طلاب الوكيل: {studentsTarget?.user?.name ?? '—'}
            </DialogTitle>
            <DialogDescription>
              قائمة بآخر 500 طالب سجّلهم هذا الوكيل.
            </DialogDescription>
          </DialogHeader>
          {studentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
            </div>
          ) : studentsList.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              لم يُسجّل هذا الوكيل أي طالب بعد.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-start text-muted-foreground border-b">
                    <th className="py-2 px-2 text-start">الطالب</th>
                    <th className="py-2 px-2 text-start">البريد</th>
                    <th className="py-2 px-2 text-start">كود الطالب</th>
                    <th className="py-2 px-2 text-start">الدورة</th>
                    <th className="py-2 px-2 text-start">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {studentsList.map((s) => (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-2">{s.student?.name ?? '—'}</td>
                      <td className="py-2 px-2" dir="ltr">{s.student?.email ?? '—'}</td>
                      <td className="py-2 px-2 font-mono text-xs">{s.student?.student_code ?? '—'}</td>
                      <td className="py-2 px-2">{s.subject?.name ?? '—'}</td>
                      <td className="py-2 px-2 text-xs">
                        {s.enrolled_at ? new Date(s.enrolled_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentsTarget(null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الوكيل؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تجريد دور الوكيل وإزالته من المصدر. تبقى سجلات التسجيلات التي أنشأها محفوظة
              للمراجعة المالية. هذا الإجراء لا يمكن التراجع عنه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
