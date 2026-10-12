'use client';

/**
 * StoragePlansView — v134m
 *
 * Redesigned: the storage plans are now displayed inside a modal
 * that opens from a button in the status card header.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  💾 مساحة التخزين          [تزويد المساحة ⬆]  [▾]    │
 *   │  ████████████░░░░░░  68%                            │
 *   │  45 / 100 ميجابايت · 55 ميجابايت متبقية            │
 *   │  [مجاني: 100MB] [مشتري: +200GB]                    │
 *   └──────────────────────────────────────────────────────┘
 *
 *   Clicking "تزويد المساحة" opens:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  ✨ ترقية مساحة التخزين                          [✕] │
 *   │  اختر الخطة المناسبة لاحتياجك — مساحة دائمة         │
 *   │                                                      │
 *   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐│
 *   │  │  50 GB   │ │  200 GB  │ │  500 GB  │ │   2 TB   ││
 *   │  │   ...    │ │   ...    │ │   ...    │ │   ...    ││
 *   │  │  20 ج.م  │ │  50 ج.م  │ │ 100 ج.م  │ │ 200 ج.م  ││
 *   │  │ [اشتراك] │ │ [اشتراك] │ │ [اشتراك] │ │ [اشتراك] ││
 *   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘│
 *   └──────────────────────────────────────────────────────┘
 */

import { useState, useEffect } from 'react';
import {
  HardDrive, Loader2, CheckCircle2, Clock, AlertCircle,
  Sparkles, ChevronDown, ChevronUp, Plus, X, Zap, Crown, Infinity as InfinityIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogScrollArea,
} from '@/components/ui/dialog';
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

/** Compact size display: returns { value, unit } for big visual display. */
function splitSize(mb: number): { value: string; unit: string } {
  if (mb >= 1048576) return { value: (mb / 1048576).toFixed(0), unit: 'تيرابايت' };
  if (mb >= 1024) return { value: (mb / 1024).toFixed(0), unit: 'جيجابايت' };
  return { value: String(mb), unit: 'ميجابايت' };
}

export default function StoragePlansView() {
  const { direction } = useTranslations();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submittedPlan, setSubmittedPlan] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);

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
  const hasPlans = status.plans.length > 0;

  // ─── Plan card accent colors (rotating palette) ───
  const planAccents = [
    { bg: 'from-sky-50 to-sky-100/50 dark:from-sky-900/20 dark:to-sky-900/5', icon: 'bg-sky-500', ring: 'ring-sky-200 dark:ring-sky-800', text: 'text-sky-700 dark:text-sky-300', btn: 'bg-sky-600 hover:bg-sky-700' },
    { bg: 'from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-900/5', icon: 'bg-violet-500', ring: 'ring-violet-200 dark:ring-violet-800', text: 'text-violet-700 dark:text-violet-300', btn: 'bg-violet-600 hover:bg-violet-700' },
    { bg: 'from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-900/5', icon: 'bg-emerald-500', ring: 'ring-emerald-200 dark:ring-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', btn: 'bg-emerald-600 hover:bg-emerald-700' },
    { bg: 'from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-900/5', icon: 'bg-amber-500', ring: 'ring-amber-200 dark:ring-amber-800', text: 'text-amber-700 dark:text-amber-300', btn: 'bg-amber-600 hover:bg-amber-700' },
  ];
  // The "popular" plan is the one with sort_order=2 (middle of 4) — or index 1 by default.
  const popularIdx = Math.min(1, Math.max(0, status.plans.length - 1));

  return (
    <div className="space-y-3" dir={direction}>
      {/* ─── Storage Status Card ─── */}
      <Card className={`border-2 ${is_full ? 'border-rose-300' : isWarning ? 'border-amber-300' : 'border-border/60'}`}>
        <CardContent className="p-4 space-y-3">
          {/* Header row — now with the "تزويد المساحة" button */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
                is_full ? 'bg-rose-100 text-rose-600' :
                isWarning ? 'bg-amber-100 text-amber-600' :
                'bg-sky-100 text-sky-600'
              }`}>
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">مساحة التخزين</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {formatSize(used_mb)} من {formatSize(total_quota)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {hasPlans && (
                <Button
                  size="sm"
                  variant={is_full ? 'default' : 'outline'}
                  className={`h-7 text-[11px] gap-1 ${
                    is_full
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : 'border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/20'
                  }`}
                  onClick={() => setShowPlansModal(true)}
                >
                  <Zap className="h-3 w-3" />
                  تزويد المساحة
                </Button>
              )}
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
                aria-label={effectiveCollapsed ? 'توسيع' : 'طي'}
              >
                {effectiveCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            </div>
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
                    المساحة ممتلئة. اضغط «تزويد المساحة» لشراء مساحة إضافية.
                  </span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Storage Plans Modal ─── */}
      <Dialog open={showPlansModal} onOpenChange={setShowPlansModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader className="pb-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-violet-500 text-white">
                <Sparkles className="h-4 w-4" />
              </div>
              ترقية مساحة التخزين
            </DialogTitle>
            <DialogDescription className="text-xs">
              اختر الخطة المناسبة لاحتياجك — المساحة المشتراة دائمة (ليست اشتراكاً شهرياً)، وتشمل الملفات والفيديوهات.
            </DialogDescription>
          </DialogHeader>

          <DialogScrollArea className="max-h-[70vh]">
            <div className="space-y-4 px-1">
              {/* ─── Current usage summary (compact, inside modal) ─── */}
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className={`h-4 w-4 ${
                      is_full ? 'text-rose-500' : isWarning ? 'text-amber-500' : 'text-emerald-500'
                    }`} />
                    <span className="text-xs font-medium">الاستخدام الحالي</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {status.active_upgrade && (
                      <Badge variant="outline" className="text-[9px] bg-sky-50 text-sky-700 border-sky-200">
                        <CheckCircle2 className="h-3 w-3 me-0.5" />
                        خطة نشطة
                      </Badge>
                    )}
                  </div>
                </div>
                <Progress
                  value={pct}
                  className={`h-2 ${
                    is_full ? '[&>div]:bg-rose-500' :
                    isWarning ? '[&>div]:bg-amber-500' :
                    '[&>div]:bg-emerald-500'
                  }`}
                />
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
                  <span>{formatSize(used_mb)} مستخدم</span>
                  <span>{formatSize(total_quota)} الإجمالي</span>
                </div>
              </div>

              {/* ─── Plans grid ─── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {status.plans.map((plan, idx) => {
                  const isCurrent = status.active_upgrade?.plan_id === plan.id;
                  const isSubmitted = submittedPlan === plan.id;
                  const accent = planAccents[idx % planAccents.length];
                  const isPopular = idx === popularIdx && !isCurrent;
                  const { value, unit } = splitSize(plan.size_mb);

                  return (
                    <Card
                      key={plan.id}
                      className={`relative overflow-hidden transition-all ${
                        isCurrent
                          ? `ring-2 ${accent.ring} bg-gradient-to-br ${accent.bg}`
                          : isPopular
                            ? `ring-2 ring-amber-300 dark:ring-amber-700 hover:shadow-lg`
                            : 'hover:shadow-md hover:border-sky-200'
                      }`}
                    >
                      {/* "شائع" ribbon for the popular plan */}
                      {isPopular && (
                        <div className="absolute top-0 inset-x-0 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[9px] font-medium text-center py-0.5 flex items-center justify-center gap-1">
                          <Crown className="h-2.5 w-2.5" />
                          الأكثر طلباً
                        </div>
                      )}

                      <CardContent className={`p-4 space-y-3 ${isPopular ? 'pt-7' : ''}`}>
                        {/* Plan name + icon */}
                        <div className="flex items-center gap-2">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent.icon} text-white shadow-sm`}>
                            <HardDrive className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{plan.name}</p>
                            {plan.name_en && (
                              <p className="text-[9px] text-muted-foreground truncate" dir="ltr">{plan.name_en}</p>
                            )}
                          </div>
                        </div>

                        {/* Big size display */}
                        <div className="text-center py-1">
                          <div className={`text-3xl font-bold ${accent.text}`} dir="ltr">
                            {value}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{unit}</div>
                        </div>

                        {/* Price */}
                        <div className="flex items-baseline justify-center gap-1 pb-1">
                          <span className={`text-xl font-bold ${accent.text}`}>
                            {Number(plan.price).toFixed(0)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{plan.currency}</span>
                        </div>

                        {/* Permanent badge */}
                        <div className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
                          <InfinityIcon className="h-3 w-3" />
                          دائمة — غير محدودة بوقت
                        </div>

                        {/* Action button */}
                        {isCurrent ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 w-full justify-center py-1.5 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 me-0.5" />
                            خطتك الحالية
                          </Badge>
                        ) : isSubmitted ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 w-full justify-center py-1.5 text-[10px]">
                            <Clock className="h-3 w-3 me-0.5" />
                            تم إرسال الطلب
                          </Badge>
                        ) : (
                          <Button
                            className={`w-full h-9 text-[11px] gap-1 ${accent.btn}`}
                            size="sm"
                            disabled={submitting === plan.id}
                            onClick={() => handleSubscribe(plan)}
                          >
                            {submitting === plan.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <><Plus className="h-3.5 w-3.5" />اشترك الآن</>}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Empty state */}
              {status.plans.length === 0 && (
                <div className="text-center py-8">
                  <HardDrive className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">لا توجد خطط ترقية متاحة حالياً.</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">يرجى التواصل مع الإدارة.</p>
                </div>
              )}

              {/* Info note */}
              <div className="rounded-lg bg-sky-50 dark:bg-sky-900/15 border border-sky-100 dark:border-sky-800 p-2.5 flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-sky-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-sky-700 dark:text-sky-300 leading-relaxed">
                  عند الإشتراك يتم إرسال طلب للإدارة والمعلم لتفعيل الاشتراك. تُضاف المساحة فور الموافقة وتشمل الملفات والفيديوهات. الملفات المحذوفة محسوبة من الإجمالي.
                </p>
              </div>
            </div>
          </DialogScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
