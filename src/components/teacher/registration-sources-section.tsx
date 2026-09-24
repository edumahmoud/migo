'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Building2, Power, Pencil, Check, X, Users } from 'lucide-react';
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
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

// ------------------------------------
// Types (local — not exported)
// ------------------------------------
type SourceKind = 'center' | 'external_office' | 'other';

interface RegistrationSource {
  id: string;
  teacher_id: string;
  name: string;
  kind: SourceKind;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  agents?: Array<{ id: string; is_active: boolean; user_id: string }>;
}

const KIND_LABEL: Record<SourceKind, string> = {
  center: 'المركز الرئيسي',
  external_office: 'مكتب خارجي',
  other: 'أخرى',
};

export default function RegistrationSourcesSection() {
  const { t } = useTranslations();

  const [sources, setSources] = useState<RegistrationSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'center' as SourceKind });
  const [saving, setSaving] = useState(false);

  // Rename dialog state
  const [editing, setEditing] = useState<RegistrationSource | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; kind: SourceKind; is_active: boolean }>(
    { name: '', kind: 'center', is_active: true }
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher/registration-sources', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        setSources([]);
      } else {
        setSources(json.sources as RegistrationSource[]);
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm({ name: '', kind: 'center' });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!form.name.trim()) {
      toast.error('الرجاء إدخال اسم للمصدر');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/teacher/registration-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم إنشاء مصدر التسجيل');
        setCreateOpen(false);
        setForm({ name: '', kind: 'center' });
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (s: RegistrationSource) => {
    setEditing(s);
    setEditForm({ name: s.name, kind: s.kind, is_active: s.is_active });
  };

  const submitEdit = async () => {
    if (!editing) return;
    if (!editForm.name.trim()) {
      toast.error('الرجاء إدخال اسم للمصدر');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/teacher/registration-sources/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم تحديث المصدر');
        setEditing(null);
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: RegistrationSource, next: boolean) => {
    try {
      const res = await fetch(`/api/teacher/registration-sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ is_active: next }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      toast.success(next ? 'تم تنشيط المصدر' : 'تم إيقاف المصدر');
      await load();
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const confirmDelete = async (s: RegistrationSource) => {
    if (!window.confirm(`حذف مصدر "${s.name}"؟ لا يمكن التراجع.`)) return;
    try {
      const res = await fetch(`/api/teacher/registration-sources/${s.id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم حذف المصدر');
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-sky-600" />
            مصادر التسجيل
          </h2>
          <p className="text-sm text-muted-foreground">
            مراكز / مكاتب يمكنك من خلالها إنشاء وكلاء تسجيل لطلابك.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 me-1" />
          مصدر جديد
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            لا توجد مصادر تسجيل بعد. اضغط &quot;مصدر جديد&quot; للبدء.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sources.map((s) => {
            const agentsCount = s.agents?.filter((a) => a.is_active).length ?? 0;
            return (
              <Card key={s.id} className={`overflow-hidden ${s.is_active ? '' : 'opacity-70 border-amber-300'}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        <span className="truncate">{s.name}</span>
                        {s.is_active ? (
                          <Badge variant="default" className="text-xs">نشط</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">معطّل</Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">
                        {KIND_LABEL[s.kind]}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(s)}
                        aria-label="تعديل"
                        title="تعديل الاسم / النوع"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => confirmDelete(s)}
                        aria-label="حذف"
                        title="حذف المصدر"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>{agentsCount} وكيل نشط</span>
                  </div>
                  {s.is_active ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => toggleActive(s, false)}
                      className="w-full text-xs"
                      title="إيقاف المصدر — سيمنع الوكلاء من تسجيل طلاب جدد عبره"
                    >
                      <Power className="h-3.5 w-3.5 me-1" />
                      إيقاف المصدر
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => toggleActive(s, true)}
                      className="w-full text-xs bg-emerald-600 hover:bg-emerald-700"
                      title="تنشيط المصدر"
                    >
                      <Power className="h-3.5 w-3.5 me-1" />
                      تنشيط المصدر
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء مصدر تسجيل جديد</DialogTitle>
            <DialogDescription>
              مثال: المركز الرئيسي، مكتب خارجي، فرع منطقة...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rs-name">الاسم</Label>
              <Input
                id="rs-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: المركز الرئيسي"
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label>النوع</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => setForm({ ...form, kind: v as SourceKind })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">{KIND_LABEL.center}</SelectItem>
                  <SelectItem value="external_office">{KIND_LABEL.external_office}</SelectItem>
                  <SelectItem value="other">{KIND_LABEL.other}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              <X className="h-4 w-4 me-1" />
              إلغاء
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل مصدر التسجيل</DialogTitle>
            <DialogDescription>يمكنك تعديل الاسم أو النوع أو الحالة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>الاسم</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label>النوع</Label>
              <Select
                value={editForm.kind}
                onValueChange={(v) => setEditForm({ ...editForm, kind: v as SourceKind })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">{KIND_LABEL.center}</SelectItem>
                  <SelectItem value="external_office">{KIND_LABEL.external_office}</SelectItem>
                  <SelectItem value="other">{KIND_LABEL.other}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={editForm.is_active ? 'default' : 'secondary'}
                onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
              >
                <Power className="h-4 w-4 me-1" />
                {editForm.is_active ? 'نشط' : 'غير نشط'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={submitEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

