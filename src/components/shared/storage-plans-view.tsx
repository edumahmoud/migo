'use client';

/**
 * StoragePlansView — v134k
 *
 * Google Drive-style storage upgrade UI (redesigned).
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  💾 مساحة التخزين                    [▾] │
 *   │  ████████████░░░░░░  68%                │
 *   │  45 / 100 ميجابايت · 55 ميجابايت متبقية │
 *   │  ┌─ مجاني: 100 ميجابايت ───────────┐    │
 *   │  │  ┌─ مشتري: +200 جيجابايت ──────┐ │    │
 *   │  │  └─────────────────────────────┘ │    │
 *   │  └──────────────────────────────────┘    │
 *   └──────────────────────────────────────────┘
 *
 *   When full:
 *   ┌──────────────────────────────────────────┐
 *   │  ⚠ المساحة ممتلئة — اختر خطة للترقية   │
 *   └──────────────────────────────────────────┘
 *
 *   Plans grid (Google Drive style):
 *   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
 *   │ 50 جيجا  │ │ 200 جيجا │ │ 500 جيجا │ │ 2 تيرا   │
 *   │  20 ج    │ │  50 ج    │ │ 100 ج    │ │ 200 ج    │
 *   │ [اشتراك] │ │ [اشتراك] │ │ [اشتراك] │ │ [اشتراك] │
 *   └──────────┘ └──────────┘ └──────────┘ └──────────┘
 */

import { useState, useEffect } from 'react';
import {
  HardDrive, Loader2, CheckCircle2, Clock, AlertCircle,
  Sparkles, ChevronDown, ChevronUp, Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
  free_quota: number;
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
  const { direction, t } = useTranslations();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submittedPlan, setSubmittedPlan] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

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
      const res = await fetch('/api/sections/activation-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({
          sectionKey: 'files',
          planType: 'monthly', // backend requires this field but it's irrelevant for storage
          requestType: 'storage_upgrade',
          planId: plan.id,
          notes: `طلب شراء مساحة تخزين: ${plan.name} (${formatSize(plan.size_mb)}) — ${plan.price} ${plan.currency}`,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم إرسال طلب شراء ${plan.name}. سيتم إشعار الإدارة والمعلم لتفعيل الاشتراك.`);
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        تعذّر تحميل بيانات التخزين
      </div>
    );
  }

  const { free_quota, upgrade_size, total_quota, used_mb, remaining_mb, pct, is_full } = status;
  const isWarning = pct >= 80;
  const effectiveCollapsed = collapsed && !is_full;

  return (
    <div className="space-y-3" dir={direction}>
      {/* ─── Storage Status Card ─── */}
      <Card className={`border-2 ${is_full ? 'border-rose-300' : isWarning ? 'border-amber-300' : 'border-border/60'}`}>
        <CardContent className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                is_full ? 'bg-rose-100 text-rose-600' :
                isWarning ? 'bg-amber-100 text-amber-600' :
                'bg-sky-100 text-sky-600'
              }`}>
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">مساحة التخزين</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatSize(used_mb)} من {formatSize(total_quota)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              {effectiveCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>

          {/* Progress bar (hidden when collapsed) */}
          {!effectiveCollapsed && (
            <>
              <div className="space-y-1">
                <Progress
                  value={pct}
                  className={`h-2.5 ${
                    is_full ? '[&>div]:bg-rose-500' :
                    isWarning ? '[&>div]:bg-amber-500' :
                    '[&>div]:bg-emerald-500'
                  }`}
                />
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">{pct}% مستخدم</span>
                  <span className={
                    is_full ? 'text-rose-600 font-medium' :
                    isWarning ? 'text-amber-600' :
                    'text-emerald-600'
                  }>
                    {is_full ? 'ممتلئة' : `${formatSize(remaining_mb)} متبقية`}
                  </span>
                </div>
              </div>

              {/* Breakdown: free + purchased */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                  مجاني: {formatSize(free_quota)}
                </Badge>
                {upgrade_size > 0 && (
                  <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200">
                    <Sparkles className="h-2.5 w-2.5 me-0.5" />
                    مشتري: +{formatSize(upgrade_size)}
                  </Badge>
                )}
              </div>

              {/* Full warning */}
              {is_full && (
                <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-2.5 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
                  <span className="text-xs text-rose-700 dark:text-rose-400">
                    المساحة ممتلئة. اختر إحدى الخطط أدناه لتزويد مساحتك.
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Plans Grid ─── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">خطط ترقية المساحة</p>
          {status.active_upgrade && (
            <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200">
              <CheckCircle2 className="h-3 w-3 me-1" />
              خطة نشطة
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {status.plans.map((plan) => {
            const isCurrent = status.active_upgrade?.plan_id === plan.id;
            const isSubmitted = submittedPlan === plan.id;
            return (
              <Card
                key={plan.id}
                className={`transition-all relative overflow-hidden ${
                  isCurrent
                    ? 'border-sky-400 bg-sky-50/50 dark:bg-sky-900/10'
                    : 'hover:border-sky-300 hover:shadow-md'
                }`}
              >
                <CardContent className="p-3 space-y-2">
                  {/* Plan name */}
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5 text-sky-600" />
                    <span className="font-medium text-xs truncate">{plan.name}</span>
                  </div>

                  {/* Size */}
                  <p className="text-[10px] text-muted-foreground">
                    {formatSize(plan.size_mb)}
                  </p>

                  {/* Price */}
                  <div className="flex items-baseline gap-0.5">
                    <span className="text-lg font-bold text-sky-700 dark:text-sky-400">
                      {Number(plan.price).toFixed(0)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{plan.currency}</span>
                  </div>

                  {/* Button */}
                  {isCurrent ? (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 w-full justify-center py-1 text-[9px]">
                      <CheckCircle2 className="h-3 w-3 me-0.5" />
                      خطتك الحالية
                    </Badge>
                  ) : isSubmitted ? (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 w-full justify-center py-1 text-[9px]">
                      <Clock className="h-3 w-3 me-0.5" />
                      تم الطلب
                    </Badge>
                  ) : (
                    <Button
                      className="w-full h-7 text-[10px]"
                      size="sm"
                      disabled={submitting === plan.id}
                      onClick={() => handleSubscribe(plan)}
                    >
                      {submitting === plan.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><Plus className="h-3 w-3 me-0.5" />اشتراك</>}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Info note */}
      <p className="text-[10px] text-muted-foreground text-center">
        المساحة المشتراة دائمة (ليست اشتراكاً شهرياً). تشمل الملفات والفيديوهات، والمحذوفة محسوبة من الإجمالي.
      </p>
    </div>
  );
}
