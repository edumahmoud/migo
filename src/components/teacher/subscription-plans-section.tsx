'use client';

/**
 * Subscription Plans Section — Teacher UI for managing
 * subscription period types (monthly/term/yearly/custom).
 *
 * Lets the teacher:
 *   - Create plans with period_type, label, duration, price
 *   - Edit existing plans
 *   - Activate/deactivate plans
 *   - Delete plans
 *
 * Active plans appear during student checkout.
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Power, PowerOff, Loader2, RefreshCw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface SubscriptionPlan {
  id: string;
  subject_id: string;
  period_type: 'monthly' | 'term' | 'yearly' | 'custom';
  period_label: string;
  duration_days: number;
  price: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface Props {
  subjectId: string;
  subjectName: string;
  defaultPrice: number;
  currency: string;
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'شهري',
  term: 'ترم',
  yearly: 'سنوي',
  custom: 'مخصص',
};

const PERIOD_DURATIONS: Record<string, number> = {
  monthly: 30,
  term: 120,
  yearly: 365,
  custom: 30,
};

export default function SubscriptionPlansSection({ subjectId, subjectName, defaultPrice, currency }: Props) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPlan, setNewPlan] = useState({
    period_type: 'monthly' as 'monthly' | 'term' | 'yearly' | 'custom',
    period_label: '',
    duration_days: 30,
    price: defaultPrice,
    currency,
  });
  const { confirmDialog, confirm } = useConfirmDialog();

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setPlans(json.data ?? []);
      } else {
        toast.error(json.error || 'فشل تحميل الخطط');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const addPlan = async () => {
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(newPlan),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إضافة خطة الاشتراك');
        setShowAddForm(false);
        await fetchPlans();
      } else {
        toast.error(json.error || 'فشل الإضافة');
      }
    } catch {
      toast.error('حدث خطأ');
    }
  };

  const togglePlan = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ is_active: !currentActive }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(currentActive ? 'تم تعطيل الخطة' : 'تم تفعيل الخطة');
        await fetchPlans();
      } else {
        toast.error(json.error || 'فشل');
      }
    } catch {
      toast.error('حدث خطأ');
    }
  };

  const deletePlan = async (id: string) => {
    const ok = await confirm({
      title: 'حذف خطة الاشتراك',
      description: 'هل تريد حذف هذه الخطة نهائيًا؟ لا يمكن التراجع.',
      confirmLabel: 'حذف',
      cancelLabel: 'تراجع',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans/${id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف الخطة');
        await fetchPlans();
      } else {
        toast.error(json.error || 'فشل الحذف');
      }
    } catch {
      toast.error('حدث خطأ');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-sky-600" />
            خطط الاشتراك — {subjectName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-8" onClick={fetchPlans} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setShowAddForm(!showAddForm)}>
              <Plus className="h-4 w-4" />
              إضافة خطة
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAddForm && (
          <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">نوع الفترة</label>
                <Select
                  value={newPlan.period_type}
                  onValueChange={(v) => {
                    const pt = v as typeof newPlan.period_type;
                    setNewPlan({
                      ...newPlan,
                      period_type: pt,
                      duration_days: PERIOD_DURATIONS[pt] || 30,
                    });
                  }}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">شهري</SelectItem>
                    <SelectItem value="term">ترم</SelectItem>
                    <SelectItem value="yearly">سنوي</SelectItem>
                    <SelectItem value="custom">مخصص</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">المدة (أيام)</label>
                <Input
                  type="number"
                  value={newPlan.duration_days}
                  onChange={(e) => setNewPlan({ ...newPlan, duration_days: Number(e.target.value) })}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">السعر</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPlan.price}
                  onChange={(e) => setNewPlan({ ...newPlan, price: Number(e.target.value) })}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">العملة</label>
                <Input
                  value={newPlan.currency}
                  onChange={(e) => setNewPlan({ ...newPlan, currency: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
            {newPlan.period_type === 'custom' && (
              <div>
                <label className="text-xs text-muted-foreground">تسمية مخصصة</label>
                <Input
                  value={newPlan.period_label}
                  onChange={(e) => setNewPlan({ ...newPlan, period_label: e.target.value })}
                  placeholder="مثال: ترم أول 2025"
                  className="h-9"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={addPlan}>حفظ الخطة</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>إلغاء</Button>
            </div>
          </div>
        )}

        {plans.length === 0 && !showAddForm ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            لا توجد خطط اشتراك بعد. اضغط "إضافة خطة" لإنشاء خطة جديدة.
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="flex items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {PERIOD_LABELS[plan.period_type] || plan.period_type}
                      </span>
                      {plan.period_label && (
                        <span className="text-xs text-muted-foreground">— {plan.period_label}</span>
                      )}
                      <Badge variant={plan.is_active ? 'default' : 'secondary'} className="text-xs">
                        {plan.is_active ? 'مفعّل' : 'معطّل'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {plan.duration_days} يوم — {Number(plan.price).toFixed(2)} {plan.currency}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => togglePlan(plan.id, plan.is_active)}
                    title={plan.is_active ? 'تعطيل' : 'تفعيل'}
                  >
                    {plan.is_active
                      ? <Power className="h-3.5 w-3.5 text-emerald-600" />
                      : <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-rose-600"
                    onClick={() => deletePlan(plan.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {confirmDialog}
    </Card>
  );
}
