'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Percent, Plus, Check, Clock, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface CommissionRate {
  id: string;
  rate_percentage: number;
  is_active: boolean;
  effective_from: string;
  created_at: string;
}

/**
 * Admin Commission Rates Management
 *
 * Lets the admin:
 *   - View ALL commission rates (current + historical)
 *   - Create a new rate (deactivates the previous, activates the new)
 *   - Activate/deactivate rates
 *
 * The rate is SNAPSHOTTED at payment time inside the
 * activate_subscription_after_payment() RPC. Changing the rate
 * only affects NEW payments — existing transactions keep their
 * snapshot value forever.
 */
export default function AdminCommissionRatesSection() {
  const { t, direction } = useTranslations();
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRate, setNewRate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/commission-rates', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setRates(json.rates ?? []);
      } else {
        toast.error(json.error || 'تعذّر جلب النسب');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  const handleCreate = async () => {
    const rate = parseFloat(newRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('النسبة يجب أن تكون بين 0 و 100');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/commission-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ rate_percentage: rate }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم تعيين النسبة الجديدة: ${rate}%`);
        setNewRate('');
        await fetchRates();
      } else {
        toast.error(json.error || 'فشل إنشاء النسبة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/commission-rates/${id}/activate`, {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تفعيل النسبة');
        await fetchRates();
      } else {
        toast.error(json.error || 'فشل التفعيل');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    }
  };

  const handleDeactivate = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/commission-rates/${id}/deactivate`, {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إلغاء تفعيل النسبة');
        await fetchRates();
      } else {
        toast.error(json.error || 'فشل إلغاء التفعيل');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    }
  };

  const activeRate = rates.find(r => r.is_active);

  return (
    <div className="space-y-4" dir={direction}>
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Percent className="h-5 w-5 text-emerald-600" />
          نسبة عمولة المنصة
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          تحكم في النسبة التي تأخذها المنصة من كل دفعة. يتم تطبيقها على المدفوعات الجديدة فقط.
        </p>
      </div>

      {/* Current rate card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">النسبة الحالية المفعّلة</div>
              <div className="text-3xl font-bold text-emerald-600">
                {activeRate ? `${activeRate.rate_percentage}%` : '0%'}
              </div>
              {activeRate && (
                <div className="text-xs text-muted-foreground mt-1">
                  مفعّلة منذ {new Date(activeRate.effective_from).toLocaleDateString('ar-EG')}
                </div>
              )}
            </div>
            <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <Percent className="h-8 w-8 text-emerald-600" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create new rate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">تعيين نسبة جديدة</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[200px]">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder="مثال: 10"
              className="text-end pe-8"
              disabled={submitting}
            />
            <span className="absolute end-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
          <Button
            onClick={handleCreate}
            disabled={submitting || !newRate}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            تعيين
          </Button>
          <p className="text-xs text-muted-foreground">
            سيتم تعطيل النسبة الحالية وتفعيل الجديدة. يؤثر على المدفوعات الجديدة فقط.
          </p>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            سجل النسب
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rates.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">لا توجد نسب مسجّلة.</div>
          ) : (
            <div className="divide-y">
              {rates.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold font-mono">{r.rate_percentage}%</span>
                    {r.is_active ? (
                      <Badge variant="default" className="text-xs bg-emerald-600">
                        <Check className="h-3 w-3 me-1" />مفعّلة
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">غير مفعّلة</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.effective_from).toLocaleDateString('ar-EG')}
                    </span>
                    {!r.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => handleActivate(r.id)}
                      >
                        <Power className="h-3 w-3" />
                        تفعيل
                      </Button>
                    )}
                    {r.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={() => handleDeactivate(r.id)}
                      >
                        <Power className="h-3 w-3" />
                        تعطيل
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
