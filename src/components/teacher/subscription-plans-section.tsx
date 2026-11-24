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
import { useTranslations } from '@/i18n/use-translations';
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

const PERIOD_KEYS: Record<string, string> = {
  monthly: 'subscriptionPlans.periodMonthly',
  term: 'subscriptionPlans.periodTerm',
  yearly: 'subscriptionPlans.periodYearly',
  custom: 'subscriptionPlans.periodCustom',
};

const PERIOD_DURATIONS: Record<string, number> = {
  monthly: 30,
  term: 120,
  yearly: 365,
  custom: 30,
};

export default function SubscriptionPlansSection({ subjectId, subjectName, defaultPrice, currency }: Props) {
  const { t } = useTranslations();
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
        toast.error(json.error || t('subscriptionPlans.loadFailed'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
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
        toast.success(t('subscriptionPlans.addSuccess'));
        setShowAddForm(false);
        await fetchPlans();
      } else {
        toast.error(json.error || t('subscriptionPlans.addFailed'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
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
        toast.success(currentActive ? t('subscriptionPlans.deactivated') : t('subscriptionPlans.activated'));
        await fetchPlans();
      } else {
        toast.error(json.error || t('subscriptionPlans.toggleFailed'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  const deletePlan = async (id: string) => {
    const ok = await confirm({
      title: t('subscriptionPlans.deleteTitle'),
      description: t('subscriptionPlans.deleteDesc'),
      confirmLabel: t('subscriptionPlans.deleteConfirm'),
      cancelLabel: t('subscriptionPlans.back'),
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
        toast.success(t('subscriptionPlans.deleteSuccess'));
        await fetchPlans();
      } else {
        toast.error(json.error || t('subscriptionPlans.deleteFailed'));
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-sky-600" />
            {t('subscriptionPlans.title', { subject: subjectName })}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-8" onClick={fetchPlans} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setShowAddForm(!showAddForm)}>
              <Plus className="h-4 w-4" />
              {t('subscriptionPlans.addPlan')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAddForm && (
          <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">{t('subscriptionPlans.periodType')}</label>
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
                    <SelectItem value="monthly">{t('subscriptionPlans.periodMonthly')}</SelectItem>
                    <SelectItem value="term">{t('subscriptionPlans.periodTerm')}</SelectItem>
                    <SelectItem value="yearly">{t('subscriptionPlans.periodYearly')}</SelectItem>
                    <SelectItem value="custom">{t('subscriptionPlans.periodCustom')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('subscriptionPlans.durationDays')}</label>
                <Input
                  type="number"
                  value={newPlan.duration_days}
                  onChange={(e) => setNewPlan({ ...newPlan, duration_days: Number(e.target.value) })}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('subscriptionPlans.price')}</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPlan.price}
                  onChange={(e) => setNewPlan({ ...newPlan, price: Number(e.target.value) })}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('subscriptionPlans.currency')}</label>
                <Input
                  value={newPlan.currency}
                  onChange={(e) => setNewPlan({ ...newPlan, currency: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
            {newPlan.period_type === 'custom' && (
              <div>
                <label className="text-xs text-muted-foreground">{t('subscriptionPlans.customLabel')}</label>
                <Input
                  value={newPlan.period_label}
                  onChange={(e) => setNewPlan({ ...newPlan, period_label: e.target.value })}
                  placeholder={t('subscriptionPlans.customPlaceholder')}
                  className="h-9"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={addPlan}>{t('subscriptionPlans.savePlan')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>{t('subscriptionPlans.cancel')}</Button>
            </div>
          </div>
        )}

        {plans.length === 0 && !showAddForm ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {t('subscriptionPlans.emptyPlans')}
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
                        {(PERIOD_KEYS[plan.period_type] ? t(PERIOD_KEYS[plan.period_type]) : '') || plan.period_type}
                      </span>
                      {plan.period_label && (
                        <span className="text-xs text-muted-foreground">— {plan.period_label}</span>
                      )}
                      <Badge variant={plan.is_active ? 'default' : 'secondary'} className="text-xs">
                        {plan.is_active ? t('subscriptionPlans.activeBadge') : t('subscriptionPlans.inactiveBadge')}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t('subscriptionPlans.daysAndPrice', { days: plan.duration_days, price: Number(plan.price).toFixed(2), currency: plan.currency })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => togglePlan(plan.id, plan.is_active)}
                    title={plan.is_active ? t('subscriptionPlans.deactivate') : t('subscriptionPlans.activate')}
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
