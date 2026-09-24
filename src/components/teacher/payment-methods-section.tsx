'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Loader2,
  Power,
  Pencil,
  Check,
  X,
  Wallet,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  Landmark,
  Repeat,
  Contact,
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

type Icon = 'wallet' | 'credit_card' | 'banknote' | 'smartphone' | 'building' | 'landmark' | 'repeat';

interface PaymentMethod {
  id: string;
  teacher_id: string;
  name: string;
  icon: Icon;
  account_identifier: string;
  contact_for_confirmation: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const ICON_LABEL: Record<Icon, string> = {
  wallet: 'محفظة',
  credit_card: 'بطاقة',
  banknote: 'نقد',
  smartphone: 'هاتف',
  building: 'بنك',
  landmark: 'تحويل بنكي',
  repeat: 'اشتراك متكرر',
};

const ICON_COMPONENT: Record<Icon, React.ComponentType<{ className?: string }>> = {
  wallet: Wallet,
  credit_card: CreditCard,
  banknote: Banknote,
  smartphone: Smartphone,
  building: Building2,
  landmark: Landmark,
  repeat: Repeat,
};

export default function PaymentMethodsSection() {
  const { t } = useTranslations();

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    icon: 'wallet' as Icon,
    account_identifier: '',
    contact_for_confirmation: '',
  });
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<PaymentMethod | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    icon: 'wallet' as Icon,
    account_identifier: '',
    contact_for_confirmation: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PaymentMethod | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teacher/payment-methods', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        setMethods([]);
      } else {
        setMethods(json.methods as PaymentMethod[]);
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
    setForm({ name: '', icon: 'wallet', account_identifier: '', contact_for_confirmation: '' });
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!form.name.trim()) {
      toast.error('أدخل اسم وسيلة الدفع');
      return;
    }
    if (!form.account_identifier.trim()) {
      toast.error('أدخل رقم الحساب / المحفظة');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/teacher/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم إنشاء وسيلة الدفع');
        setCreateOpen(false);
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (m: PaymentMethod) => {
    setEditTarget(m);
    setEditForm({
      name: m.name,
      icon: m.icon,
      account_identifier: m.account_identifier,
      contact_for_confirmation: m.contact_for_confirmation ?? '',
    });
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editForm.name.trim()) {
      toast.error('أدخل اسم وسيلة الدفع');
      return;
    }
    if (!editForm.account_identifier.trim()) {
      toast.error('أدخل رقم الحساب / المحفظة');
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/teacher/payment-methods/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم تحديث وسيلة الدفع');
        setEditTarget(null);
        await load();
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setEditSaving(false);
    }
  };

  const toggleActive = async (m: PaymentMethod, next: boolean) => {
    try {
      const res = await fetch(`/api/teacher/payment-methods/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ is_active: next }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
        return;
      }
      toast.success(next ? 'تم تفعيل وسيلة الدفع' : 'تم إيقاف وسيلة الدفع');
      await load();
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/teacher/payment-methods/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('common.unexpectedError'));
      } else {
        toast.success('تم حذف وسيلة الدفع');
        setDeleteTarget(null);
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
            <Wallet className="h-5 w-5 text-sky-600" />
            وسائل الدفع
          </h2>
          <p className="text-sm text-muted-foreground">
            تظهر وسائل الدفع للطلاب المرتبطين بك في حساباتهم لمساعدتهم على معرفة كيفية الدفع.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 me-1" />
          إضافة وسيلة
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
        </div>
      ) : methods.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
            لا توجد وسائل دفع بعد. اضغط &quot;إضافة وسيلة&quot; للبدء.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {methods.map((m) => {
            const IconComp = ICON_COMPONENT[m.icon] ?? Wallet;
            return (
              <Card
                key={m.id}
                className={`overflow-hidden ${m.is_active ? '' : 'opacity-60 border-amber-300'}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="h-9 w-9 rounded-lg bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center shrink-0">
                        <IconComp className="h-5 w-5 text-sky-600" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{m.name}</CardTitle>
                        <CardDescription className="text-xs">{ICON_LABEL[m.icon]}</CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(m)}
                        aria-label="تعديل"
                        title="تعديل"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTarget(m)}
                        aria-label="حذف"
                        title="حذف"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">رقم الحساب / المحفظة</div>
                    <div className="font-mono text-sm bg-muted px-2 py-1 rounded break-all" dir="ltr">
                      {m.account_identifier}
                    </div>
                  </div>
                  {m.contact_for_confirmation && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">للتأكيد تواصل على</div>
                      <div className="text-sm" dir="ltr">{m.contact_for_confirmation}</div>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <Badge variant={m.is_active ? 'default' : 'secondary'}>
                      {m.is_active ? 'نشط' : 'معطّل'}
                    </Badge>
                    <Button
                      size="sm"
                      variant={m.is_active ? 'destructive' : 'default'}
                      onClick={() => toggleActive(m, !m.is_active)}
                      className="text-xs"
                    >
                      <Power className="h-3.5 w-3.5 me-1" />
                      {m.is_active ? 'إيقاف' : 'تنشيط'}
                    </Button>
                  </div>
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
            <DialogTitle>إضافة وسيلة دفع جديدة</DialogTitle>
            <DialogDescription>
              مثال: فودافون كاش، إنستا باي، تحويل بنكي...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>الاسم</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثال: فودافون كاش"
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label>الأيقونة</Label>
              <Select
                value={form.icon}
                onValueChange={(v) => setForm({ ...form, icon: v as Icon })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ICON_LABEL).map(([key, label]) => {
                    const Ico = ICON_COMPONENT[key as Icon];
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <Ico className="h-4 w-4" />
                          {label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>رقم الحساب / المحفظة</Label>
              <Input
                value={form.account_identifier}
                onChange={(e) => setForm({ ...form, account_identifier: e.target.value })}
                placeholder="مثال: 01012345678"
                dir="ltr"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label>للتأكيد تواصل على (اختياري)</Label>
              <Input
                value={form.contact_for_confirmation}
                onChange={(e) => setForm({ ...form, contact_for_confirmation: e.target.value })}
                placeholder="مثال: 01087654321 (واتساب)"
                dir="ltr"
                maxLength={120}
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
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل وسيلة الدفع</DialogTitle>
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
              <Label>الأيقونة</Label>
              <Select
                value={editForm.icon}
                onValueChange={(v) => setEditForm({ ...editForm, icon: v as Icon })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ICON_LABEL).map(([key, label]) => {
                    const Ico = ICON_COMPONENT[key as Icon];
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <Ico className="h-4 w-4" />
                          {label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>رقم الحساب / المحفظة</Label>
              <Input
                value={editForm.account_identifier}
                onChange={(e) => setEditForm({ ...editForm, account_identifier: e.target.value })}
                dir="ltr"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label>للتأكيد تواصل على</Label>
              <Input
                value={editForm.contact_for_confirmation}
                onChange={(e) => setEditForm({ ...editForm, contact_for_confirmation: e.target.value })}
                dir="ltr"
                maxLength={120}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={editSaving}>
              إلغاء
            </Button>
            <Button onClick={submitEdit} disabled={editSaving}>
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف وسيلة الدفع؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف وسيلة الدفع نهائياً. لن يراها الطلاب بعد ذلك.
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
