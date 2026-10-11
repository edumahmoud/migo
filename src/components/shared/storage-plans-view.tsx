'use client';

/**
 * StoragePlansView — v134i
 *
 * Google Drive-style storage upgrade UI.
 * Shown when the user's storage is full (or when they want to upgrade).
 *
 * Shows:
 *   - Current usage: "45 / 100 ميجابايت مستخدمة"
 *   - Progress bar
 *   - Available upgrade plans as cards (like Google Drive pricing page)
 *   - Each card: plan name + size + price + "اشتراك" button
 *   - Clicking a plan submits a request to the admin
 */

import { useState, useEffect } from 'react';
import { HardDrive, Loader2, CheckCircle2, Clock, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface StoragePlan {
  id: string;
  name: string;
  name_en: string | null;
  size_mb: number;
  price: number;
  currency: string;
  sort_order: number;
}

interface StorageStatus {
  default_quota: number;
  upgrade_size: number;
  total_quota: number;
  used_mb: number;
  remaining_mb: number;
  pct: number;
  is_full: boolean;
  active_upgrade: { id: string; plan_id: string; size_mb: number; price: number } | null;
  plans: StoragePlan[];
}

function formatSize(mb: number): string {
  if (mb >= 1048576) return `${(mb / 1048576).toFixed(0)} تيرابايت`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(0)} جيجابايت`;
  return `${mb} ميجابايت`;
}

export default function StoragePlansView() {
  const { direction } = useTranslations();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submittedPlan, setSubmittedPlan] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/storage/check', {
          headers: await getCachedAuthHeaders(),
        });
        const json = await res.json();
        if (json.success) setStatus(json);
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubscribe = async (plan: StoragePlan) => {
    setSubmitting(plan.id);
    try {
      // Submit as an activation request for the 'files' section with
      // plan_type='monthly' (the backend uses this as a generic marker).
      // The admin sees the request + can see which storage plan was
      // requested via the notes field.
      const res = await fetch('/api/sections/activation-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({
          sectionKey: 'files',
          planType: 'monthly',
          notes: `طلب ترقية مساحة التخزين: ${plan.name} (${formatSize(plan.size_mb)}) — ${plan.price} ${plan.currency}`,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم إرسال طلب الاشتراك في ${plan.name}. سيتم التواصل معك للتأكيد.`);
        setSubmittedPlan(plan.id);
      } else {
        toast.error(json.error || 'فشل إرسال الطلب');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        تعذّر تحميل بيانات التخزين
      </div>
    );
  }

  const pct = status.pct;
  const isWarning = pct >= 80;
  const isFull = status.is_full;

  return (
    <div className="space-y-4" dir={direction}>
      {/* Current usage header */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-sky-600" />
            <span className="font-medium text-sm">مساحة التخزين</span>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">
                {status.used_mb} / {status.total_quota} ميجابايت مستخدمة
              </span>
              <span className={`text-xs font-medium ${
                isFull ? 'text-rose-600' : isWarning ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                {pct}%
              </span>
            </div>
            <Progress
              value={pct}
              className={`h-2 ${isFull ? '[&>div]:bg-rose-500' : isWarning ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`}
            />
          </div>
          {status.active_upgrade && (
            <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
              <Sparkles className="h-3 w-3 me-1" />
              خطة نشطة: +{formatSize(status.active_upgrade.size_mb)}
            </Badge>
          )}
          {isFull && (
            <div className="rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>المساحة ممتلئة. اختر إحدى الخطط أدناه لتزويد مساحتك.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plans grid */}
      <div>
        <p className="text-sm font-medium mb-2">خطط الترقية</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {status.plans.map((plan) => {
            const isCurrent = status.active_upgrade?.plan_id === plan.id;
            const isSubmitted = submittedPlan === plan.id;
            return (
              <Card
                key={plan.id}
                className={`transition-all ${
                  isCurrent ? 'border-sky-400 bg-sky-50/50 dark:bg-sky-900/10' : ''
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Plan name + size */}
                  <div>
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-sky-600" />
                      <span className="font-medium text-sm">{plan.name}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatSize(plan.size_mb)}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-sky-700 dark:text-sky-400">
                      {Number(plan.price).toFixed(0)}
                    </span>
                    <span className="text-xs text-muted-foreground">{plan.currency}</span>
                  </div>

                  {/* Action button */}
                  {isCurrent ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 w-full justify-center py-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 me-1" />
                      خطتك الحالية
                    </Badge>
                  ) : isSubmitted ? (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 w-full justify-center py-1.5">
                      <Clock className="h-3.5 w-3.5 me-1" />
                      تم إرسال الطلب
                    </Badge>
                  ) : (
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={submitting === plan.id}
                      onClick={() => handleSubscribe(plan)}
                    >
                      {submitting === plan.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : 'اشتراك'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-md bg-muted/30 border p-3 text-[11px] text-muted-foreground">
        المساحة المشتراة دائمة (ليست اشتراكاً شهرياً). تشمل جميع الملفات المرفوعة، والمحذوفة محسوبة من الإجمالي.
      </div>
    </div>
  );
}
