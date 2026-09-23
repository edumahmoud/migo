'use client';

import { useCallback, useEffect, useState } from 'react';
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
  source?: SourceLite | null;
  user?: AgentUser | null;
}

export default function RegistrationAgentsSection() {
  const { t } = useTranslations();

  const [agents, setAgents] = useState<RegistrationAgent[]>([]);
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [loading, setLoading] = useState(true);

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

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/registration-sources', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        const list = (json.sources as Array<{ id: string; name: string; kind: string }>).map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
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

  const openCreate = () => {
    if (sources.length === 0) {
      toast.error('يرجى إنشاء مصدر تسجيل أولاً من قسم &quot;مصادر التسجيل&quot;');
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
      const res = await fetch(`/api/teacher/registration-agents?id=${a.id}`, {
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
      const res = await fetch(`/api/teacher/registration-agents?id=${deleteTarget.id}`, {
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

      <div className="space-y-3">
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

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
          </div>
        ) : agents.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              لا يوجد وكلاء تسجيل بعد.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {agents.map((a) => (
              <Card key={a.id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {a.user?.name ?? a.user?.email ?? 'وكيل'}
                        {a.is_active ? (
                          <Badge variant="default" className="text-xs">نشط</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">معطّل</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {a.user?.email}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleActive(a, !a.is_active)}
                        aria-label="تبديل الحالة"
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTarget(a)}
                        aria-label="حذف"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  <div>
                    المصدر: <span className="font-medium text-foreground">{a.source?.name ?? '—'}</span>
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
