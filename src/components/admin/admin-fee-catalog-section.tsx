'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Percent, Banknote, Power, PowerOff, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface FeeCatalogRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  fee_kind: 'percentage' | 'flat';
  value: number;
  is_active: boolean;
  sort_order: number;
  effective_from: string;
  created_at: string;
  updated_at: string;
}

interface NewFeeForm {
  code: string;
  name_ar: string;
  name_en: string;
  description: string;
  fee_kind: 'percentage' | 'flat';
  value: string;
  sort_order: string;
}

const EMPTY_FORM: NewFeeForm = {
  code: '',
  name_ar: '',
  name_en: '',
  description: '',
  fee_kind: 'percentage',
  value: '',
  sort_order: '0',
};

export default function AdminFeeCatalogSection() {
  const { t, direction } = useTranslations();
  const [fees, setFees] = useState<FeeCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<NewFeeForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchFees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/fee-catalog', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setFees(json.data ?? []);
      } else {
        toast.error(json.error || 'تعذّر جلب الرسوم');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFees(); }, [fetchFees]);

  const handleCreate = async () => {
    if (submitting) return;
    if (!form.code || !form.name_ar || !form.name_en || !form.value) {
      toast.error('الكود + الاسم بالعربي + الاسم بالإنجليزي + القيمة كلها مطلوبة');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/fee-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          code: form.code.trim().toLowerCase(),
          name_ar: form.name_ar.trim(),
          name_en: form.name_en.trim(),
          description: form.description.trim() || undefined,
          fee_kind: form.fee_kind,
          value: Number(form.value),
          sort_order: Number(form.sort_order) || 0,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إنشاء الرسوم بنجاح');
        setForm(EMPTY_FORM);
        await fetchFees();
      } else {
        toast.error(json.error || 'فشل الإنشاء');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (id: string) => {
    const res = await fetch(`/api/admin/fee-catalog/${id}/activate`, {
      method: 'POST',
      headers: await getCachedAuthHeaders(),
    });
    const json = await res.json();
    if (json.success) {
      toast.success('تم التفعيل');
      await fetchFees();
    } else {
      toast.error(json.error || 'فشل التفعيل');
    }
  };

  const handleDeactivate = async (id: string) => {
    const res = await fetch(`/api/admin/fee-catalog/${id}/deactivate`, {
      method: 'POST',
      headers: await getCachedAuthHeaders(),
    });
    const json = await res.json();
    if (json.success) {
      toast.success('تم التعطيل');
      await fetchFees();
    } else {
      toast.error(json.error || 'فشل التعطيل');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('تأكيد الحذف؟ لا يمكن التراجع.')) return;
    const res = await fetch(`/api/admin/fee-catalog/${id}`, {
      method: 'DELETE',
      headers: await getCachedAuthHeaders(),
    });
    const json = await res.json();
    if (json.success) {
      toast.success('تم الحذف');
      await fetchFees();
    } else {
      toast.error(json.error || 'فشل الحذف');
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId || !form.value) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/fee-catalog/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          name_ar: form.name_ar.trim() || undefined,
          name_en: form.name_en.trim() || undefined,
          description: form.description.trim() || null,
          value: Number(form.value),
          sort_order: Number(form.sort_order) || 0,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم التحديث');
        setEditingId(null);
        setForm(EMPTY_FORM);
        await fetchFees();
      } else {
        toast.error(json.error || 'فشل التحديث');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (fee: FeeCatalogRow) => {
    setEditingId(fee.id);
    setForm({
      code: fee.code, // displayed but immutable
      name_ar: fee.name_ar,
      name_en: fee.name_en,
      description: fee.description ?? '',
      fee_kind: fee.fee_kind,
      value: String(fee.value),
      sort_order: String(fee.sort_order),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-4" dir={direction}>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Banknote className="h-5 w-5 text-sky-600" />
          كتالوج الرسوم (Fees-on-top)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          الرسوم دي بتتضاف على إجمالي الاشتراكات + بتتحسب على الطالب وقت الدفع. المجموع الكلي (الإجمالي) هو اللي بيتعمل بوابة Paymob.
        </p>
      </div>

      {/* Create/Edit form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {editingId ? 'تعديل رسوم' : 'إضافة رسوم جديدة'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الكود (إنجليزي، immutable)</label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="مثال: tax / processing_fee / custom_fee_1"
                disabled={!!editingId || submitting}
                className="text-start font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الاسم بالعربي</label>
              <Input
                value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                placeholder="مثال: ضريبة القيمة المضافة"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">الاسم بالإنجليزي</label>
              <Input
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                placeholder="e.g., VAT"
                disabled={submitting}
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">النوع</label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={form.fee_kind === 'percentage' ? 'default' : 'outline'}
                  className="h-9 gap-1"
                  onClick={() => setForm({ ...form, fee_kind: 'percentage' })}
                  disabled={!!editingId || submitting}
                >
                  <Percent className="h-3 w-3" />
                  نسبة %
                </Button>
                <Button
                  size="sm"
                  variant={form.fee_kind === 'flat' ? 'default' : 'outline'}
                  className="h-9 gap-1"
                  onClick={() => setForm({ ...form, fee_kind: 'flat' })}
                  disabled={!!editingId || submitting}
                >
                  <Banknote className="h-3 w-3" />
                  مبلغ ثابت
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                القيمة {form.fee_kind === 'percentage' ? '(%)' : '(EGP)'}
              </label>
              {/* IMPORTANT: pointer-events-none on the suffix span so it doesn't
                  intercept clicks on the input field. The previous commission
                  rates UI had a bug where the % suffix ate clicks → input appeared
                  to not accept values. */}
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max={form.fee_kind === 'percentage' ? 100 : undefined}
                  step="0.5"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder={form.fee_kind === 'percentage' ? 'مثال: 14' : 'مثال: 5'}
                  disabled={submitting}
                  className="text-end pe-8"
                />
                <span className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {form.fee_kind === 'percentage' ? '%' : 'EGP'}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">ترتيب العرض</label>
              <Input
                type="number"
                min="0"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                placeholder="0"
                disabled={submitting}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">وصف اختياري</label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="مثال: ضريبة القيمة المضافة 14% — تُحسب من إجمالي الاشتراكات"
              disabled={submitting}
            />
          </div>
          <div className="flex gap-2">
            {editingId ? (
              <>
                <Button
                  onClick={handleSaveEdit}
                  disabled={submitting || !form.value}
                  className="bg-sky-600 hover:bg-sky-700 text-white gap-1"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  حفظ التعديل
                </Button>
                <Button onClick={cancelEdit} variant="outline" disabled={submitting}>
                  إلغاء
                </Button>
              </>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={submitting || !form.code || !form.name_ar || !form.name_en || !form.value}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                إنشاء
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Fees list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الرسوم المُعرّفة</CardTitle>
          {fees.length > 0 && (
            <CardDescription className="text-xs">
              {fees.length} رسوم — {fees.filter(f => f.is_active).length} مفعّلة
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : fees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Banknote className="h-12 w-12 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد رسوم بعد. أنشئ أول رسوم فوق.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="p-3 text-start font-medium">الكود</th>
                    <th className="p-3 text-start font-medium">الاسم</th>
                    <th className="p-3 text-start font-medium">النوع</th>
                    <th className="p-3 text-end font-medium">القيمة</th>
                    <th className="p-3 text-center font-medium">الحالة</th>
                    <th className="p-3 text-center font-medium">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((fee) => (
                    <tr key={fee.id} className="border-b hover:bg-muted/20">
                      <td className="p-3 font-mono text-xs text-sky-700">{fee.code}</td>
                      <td className="p-3">
                        <div className="font-medium">{fee.name_ar}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{fee.name_en}</div>
                        {fee.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">{fee.description}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs">
                          {fee.fee_kind === 'percentage' ? '%' : 'EGP'}
                          {' '}
                          {fee.fee_kind === 'percentage' ? 'نسبة' : 'ثابت'}
                        </Badge>
                      </td>
                      <td className="p-3 text-end font-mono font-bold">
                        {Number(fee.value).toFixed(fee.fee_kind === 'percentage' ? 2 : 2)}
                        {fee.fee_kind === 'percentage' ? '%' : ' EGP'}
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant={fee.is_active ? 'default' : 'outline'} className="text-xs">
                          {fee.is_active ? 'مفعّل' : 'معطّل'}
                        </Badge>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => startEdit(fee)}
                            title="تعديل"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {fee.is_active ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-amber-600"
                              onClick={() => handleDeactivate(fee.id)}
                              title="تعطيل"
                            >
                              <PowerOff className="h-3 w-3" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-emerald-600"
                              onClick={() => handleActivate(fee.id)}
                              title="تفعيل"
                            >
                              <Power className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-rose-600"
                            onClick={() => handleDelete(fee.id)}
                            title="حذف"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Example calculation preview */}
      <Card className="bg-sky-50/50 dark:bg-sky-900/10">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-2">مثال على الحساب</h3>
          <p className="text-xs text-muted-foreground mb-2">
            لو الطالب اشترك في مقرر بـ 100 EGP والرسوم المفعّلة هي:
          </p>
          <div className="text-xs font-mono space-y-1" dir="ltr">
            <div>Subscriptions total:  100.00 EGP</div>
            {fees.filter(f => f.is_active).map(f => (
              <div key={f.id}>
                {f.name_en} ({f.fee_kind === 'percentage' ? `${f.value}%` : `${f.value} EGP flat`}):
                {' +'}{(f.fee_kind === 'percentage' ? 100 * f.value / 100 : f.value).toFixed(2)} EGP
              </div>
            ))}
            <div className="border-t pt-1 mt-1">
              Grand total (sent to Paymob):{' '}
              {(100 + fees
                .filter(f => f.is_active)
                .reduce((sum, f) => sum + (f.fee_kind === 'percentage' ? 100 * f.value / 100 : f.value), 0)
              ).toFixed(2)} EGP
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
