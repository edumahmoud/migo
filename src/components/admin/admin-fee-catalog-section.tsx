'use client';

/**
 * Admin Fee Catalog Section — v88 fees-on-top model
 *
 * Simple, clean UI for managing the fee catalog. Each fee is one row
 * in the table — no example calculation preview, no separate create
 * form modal — the create form is inline at the top.
 *
 * Each fee has:
 *   - code (immutable, lowercase slug — e.g. 'platform_commission', 'tax')
 *   - name_ar + name_en (display name in both languages)
 *   - fee_kind ('percentage' | 'flat')
 *   - value (0-100 for percentage, any positive EGP for flat)
 *   - is_active (toggle)
 *   - sort_order (display order)
 *
 * Actions per row: edit / activate / deactivate / delete (with guard).
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Percent, Banknote, Power, PowerOff, Trash2, Pencil, Receipt, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const [showCreate, setShowCreate] = useState(false);
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

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (submitting) return;
    if (!form.code || !form.name_ar || !form.name_en || !form.value) {
      toast.error('كل الحقول المطلوبة لازم تتملى');
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
        resetForm();
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

  const handleUpdate = async () => {
    if (!editingId || submitting) return;
    if (!form.value) {
      toast.error('القيمة مطلوبة');
      return;
    }
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
        resetForm();
        await fetchFees();
      } else {
        toast.error(json.error || 'فشل التحديث');
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
    if (!confirm('تأكيد الحذف؟ لا يمكن التراجع. الرسوم اللي اتمسحت مينفعش تتعرف على الطلبات القديمة (snapshot بيفضل موجود، لكن الرابط بينالهم ما بيتعدّلش).')) return;
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

  const startEdit = (fee: FeeCatalogRow) => {
    setEditingId(fee.id);
    setForm({
      code: fee.code,
      name_ar: fee.name_ar,
      name_en: fee.name_en,
      description: fee.description ?? '',
      fee_kind: fee.fee_kind,
      value: String(fee.value),
      sort_order: String(fee.sort_order),
    });
    setShowCreate(true);
  };

  return (
    <div className="space-y-4" dir={direction}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Receipt className="h-5 w-5 text-sky-600" />
            الرسوم
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            كل الرسوم المُعرّفة هنا بتتضاف على إجمالي الاشتراكات قبل ما الطالب يدفع.
          </p>
        </div>
        {!showCreate && (
          <Button
            size="sm"
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="bg-sky-600 hover:bg-sky-700 text-white gap-1"
          >
            <Plus className="h-4 w-4" />
            إضافة رسوم
          </Button>
        )}
      </div>

      {/* Create/Edit form (collapsible) */}
      {showCreate && (
        <Card className="border-sky-200 dark:border-sky-900/40">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {editingId ? 'تعديل رسوم' : 'إضافة رسوم جديدة'}
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={resetForm} disabled={submitting} className="h-7">
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Code (immutable in edit mode) */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">الكود</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="tax / processing_fee"
                  disabled={!!editingId || submitting}
                  className="text-start font-mono text-xs"
                />
              </div>

              {/* Name (Arabic) */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">الاسم (عربي)</label>
                <Input
                  value={form.name_ar}
                  onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                  placeholder="ضريبة القيمة المضافة"
                  disabled={submitting}
                />
              </div>

              {/* Name (English) */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">الاسم (إنجليزي)</label>
                <Input
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  placeholder="VAT"
                  disabled={submitting}
                  dir="ltr"
                />
              </div>

              {/* Fee kind toggle */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">النوع</label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={form.fee_kind === 'percentage' ? 'default' : 'outline'}
                    className="h-9 gap-1 flex-1"
                    onClick={() => setForm({ ...form, fee_kind: 'percentage' })}
                    disabled={!!editingId || submitting}
                  >
                    <Percent className="h-3 w-3" />
                    نسبة %
                  </Button>
                  <Button
                    size="sm"
                    variant={form.fee_kind === 'flat' ? 'default' : 'outline'}
                    className="h-9 gap-1 flex-1"
                    onClick={() => setForm({ ...form, fee_kind: 'flat' })}
                    disabled={!!editingId || submitting}
                  >
                    <Banknote className="h-3 w-3" />
                    مبلغ
                  </Button>
                </div>
              </div>

              {/* Value */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  القيمة {form.fee_kind === 'percentage' ? '(%)' : '(EGP)'}
                </label>
                {/* IMPORTANT: pointer-events-none on the suffix span so it doesn't
                    intercept clicks on the input field. */}
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    max={form.fee_kind === 'percentage' ? 100 : undefined}
                    step="0.5"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    placeholder={form.fee_kind === 'percentage' ? '14' : '5'}
                    disabled={submitting}
                    className="text-end pe-10"
                  />
                  <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
                    {form.fee_kind === 'percentage' ? '%' : 'EGP'}
                  </span>
                </div>
              </div>

              {/* Sort order */}
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

              {/* Description */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">وصف اختياري</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="ضريبة 14% — تحسب من إجمالي الاشتراكات"
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button onClick={resetForm} variant="outline" disabled={submitting}>
                إلغاء
              </Button>
              <Button
                onClick={editingId ? handleUpdate : handleCreate}
                disabled={
                  submitting ||
                  (!editingId && (!form.code || !form.name_ar || !form.name_en || !form.value))
                }
                className="bg-sky-600 hover:bg-sky-700 text-white gap-1"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingId ? 'حفظ التعديل' : 'إنشاء'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fees table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : fees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Receipt className="h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                ما فيش رسوم بعد. اضغط "إضافة رسوم" لإنشاء أول واحدة.
              </p>
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
                      <td className="p-3 font-mono text-xs text-sky-700 dark:text-sky-300">
                        {fee.code}
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{fee.name_ar}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{fee.name_en}</div>
                        {fee.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {fee.description}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs gap-1">
                          {fee.fee_kind === 'percentage' ? <Percent className="h-3 w-3" /> : <Banknote className="h-3 w-3" />}
                          {fee.fee_kind === 'percentage' ? 'نسبة' : 'مبلغ'}
                        </Badge>
                      </td>
                      <td className="p-3 text-end font-mono font-bold">
                        {Number(fee.value).toFixed(fee.fee_kind === 'percentage' ? 2 : 2)}
                        <span className="text-xs text-muted-foreground ms-1">
                          {fee.fee_kind === 'percentage' ? '%' : 'EGP'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          fee.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${fee.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                          {fee.is_active ? 'مفعّل' : 'معطّل'}
                        </span>
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
    </div>
  );
}
