'use client';

/**
 * StoragePlansView — v134q
 *
 * The storage plans modal (opens from the status card header button).
 *
 * v134q changes:
 *   - Plans are SUBSCRIPTIONS: monthly or yearly (duration toggle).
 *   - Compact cards (no oversized size display, no fake "most popular"
 *     ribbon, no bottom info note).
 *   - Plans smaller than the current active upgrade are restricted.
 *   - The status card shows the subscription expiry countdown.
 */

import { useState, useEffect } from 'react';
import {
  HardDrive, Loader2, CheckCircle2, Clock, AlertCircle,
  Sparkles, ChevronDown, ChevronUp, Plus, Zap, CalendarClock,
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
  price_monthly: number | null; // v134q: subscription prices
  price_yearly: number | null;  // v134q: NULL = yearly not offered
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
  active_upgrade: {
    id: string;
    plan_id: string;
    size_mb: number;
    price: number;
    duration_type?: 'permanent' | 'monthly' | 'yearly' | null; // v134q
    expires_at?: string | null;                                  // v134q
  } | null;
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

/** Days left until an ISO expiry date (null when permanent/no expiry). */
function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function StoragePlansView() {
  const { direction } = useTranslations();
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submittedPlan, setSubmittedPlan] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  // v134q: subscription duration selected in the modal (monthly/yearly).
  const [duration, setDuration] = useState<'monthly' | 'yearly'>('monthly');

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
          planType: duration, // v134q: the selected subscription duration (monthly/yearly)
          requestType: 'storage_upgrade',
          planId: plan.id,
          notes: `طلب اشتراك مساحة تخزين: ${plan.name} (${formatSize(plan.size_mb)}) — ${duration === 'monthly' ? 'شهري' : 'سنوي'}`,
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

  // v134q derived values:
  //   - expiryDaysLeft: days remaining on the current subscription (null = permanent/none).
  //   - currentSizeMb: the active (non-expired) upgrade's size — used to
  //     restrict subscribing to SMALLER plans (same size is allowed for renewal).
  //   - hasYearly: whether ANY plan offers a yearly price → controls the
  //     duration toggle visibility.
  const expiryDaysLeft = daysLeft(status.active_upgrade?.expires_at);
  const currentSizeMb = status.active_upgrade?.size_mb ?? 0;
  const hasYearly = status.plans.some(p => p.price_yearly != null);

  // ─── Plan card accent colors (rotating palette) ───
  const planAccents = [
    { bg: 'from-sky-50 to-sky-100/50 dark:from-sky-900/20 dark:to-sky-900/5', icon: 'bg-sky-500', ring: 'ring-sky-200 dark:ring-sky-800', text: 'text-sky-700 dark:text-sky-300', btn: 'bg-sky-600 hover:bg-sky-700' },
    { bg: 'from-violet-50 to-violet-100/50 dark:from-violet-900/20 dark:to-violet-900/5', icon: 'bg-violet-500', ring: 'ring-violet-200 dark:ring-violet-800', text: 'text-violet-700 dark:text-violet-300', btn: 'bg-violet-600 hover:bg-violet-700' },
    { bg: 'from-emerald-50 to-emerald-100/50 dark:from-emerald-900/20 dark:to-emerald-900/5', icon: 'bg-emerald-500', ring: 'ring-emerald-200 dark:ring-emerald-800', text: 'text-emerald-700 dark:text-emerald-300', btn: 'bg-emerald-600 hover:bg-emerald-700' },
    { bg: 'from-amber-50 to-amber-100/50 dark:from-amber-900/20 dark:to-amber-900/5', icon: 'bg-amber-500', ring: 'ring-amber-200 dark:ring-amber-800', text: 'text-amber-700 dark:text-amber-300', btn: 'bg-amber-600 hover:bg-amber-700' },
  ];

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

              {/* Breakdown: free + purchased (+ subscription expiry) */}
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
                {/* v134q: subscription expiry countdown */}
                {upgrade_size > 0 && expiryDaysLeft != null && (
                  <Badge variant="outline" className={`text-[9px] ${
                    expiryDaysLeft <= 7
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    <CalendarClock className="h-2.5 w-2.5 me-0.5" />
                    {expiryDaysLeft <= 0
                      ? 'انتهى الاشتراك'
                      : `ينتهي بعد ${expiryDaysLeft} يوم`}
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
              اختر الخطة والمدة المناسبة لاحتياجك — اشتراك شهري أو سنوي يشمل الملفات والفيديوهات.
            </DialogDescription>
          </DialogHeader>

          <DialogScrollArea className="max-h-[70vh]">
            <div className="space-y-3 px-1">
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
                      <Badge variant="outline" className={`text-[9px] ${
                        expiryDaysLeft != null && expiryDaysLeft <= 7
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-sky-50 text-sky-700 border-sky-200'
                      }`}>
                        <CheckCircle2 className="h-3 w-3 me-0.5" />
                        {status.active_upgrade.duration_type === 'permanent'
                          ? 'خطة دائمة'
                          : expiryDaysLeft != null
                            ? `خطة نشطة · ${expiryDaysLeft} يوم متبقٍ`
                            : 'خطة نشطة'}
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

              {/* ─── v134q: Duration toggle (monthly / yearly) ─── */}
              {hasPlans && hasYearly && (
                <div className="flex items-center p-1 rounded-xl bg-muted/60 border gap-1">
                  <button
                    type="button"
                    onClick={() => setDuration('monthly')}
                    className={`flex-1 h-8 rounded-lg text-xs font-medium transition-all ${
                      duration === 'monthly'
                        ? 'bg-background shadow-sm text-foreground border'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    شهري
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration('yearly')}
                    className={`flex-1 h-8 rounded-lg text-xs font-medium transition-all ${
                      duration === 'yearly'
                        ? 'bg-background shadow-sm text-foreground border'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    سنوي
                  </button>
                </div>
              )}

              {/* ─── Plans grid (v134q: compact cards) ─── */}
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {status.plans.map((plan, idx) => {
                  const isCurrent = status.active_upgrade?.plan_id === plan.id;
                  const isSubmitted = submittedPlan === plan.id;
                  const accent = planAccents[idx % planAccents.length];
                  const { value, unit } = splitSize(plan.size_mb);

                  // v134q: restrict plans SMALLER than the current active
                  // upgrade. Same size is allowed (renewal/extension).
                  const isSmaller = currentSizeMb > 0 && plan.size_mb < currentSizeMb;
                  // Yearly selected but this plan has no yearly price.
                  const yearlyUnavailable = duration === 'yearly' && plan.price_yearly == null;
                  const planPrice = duration === 'yearly'
                    ? plan.price_yearly
                    : (plan.price_monthly ?? plan.price);
                  const isRenewal = !isCurrent && currentSizeMb > 0 && plan.size_mb === currentSizeMb;

                  return (
                    <Card
                      key={plan.id}
                      className={`relative overflow-hidden transition-all ${
                        isCurrent
                          ? `ring-2 ${accent.ring} bg-gradient-to-br ${accent.bg}`
                          : isSmaller
                            ? 'opacity-55'
                            : 'hover:shadow-md hover:border-sky-200'
                      }`}
                    >
                      <CardContent className="p-2.5 space-y-2">
                        {/* Size row */}
                        <div className="flex items-center gap-2">
                          <div className={`flex h-7 w-7 items-center justify-center rounded-md ${accent.icon} text-white shrink-0`}>
                            <HardDrive className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-bold leading-tight ${accent.text}`} dir="ltr">
                              {value} <span className="text-[9px] font-medium">{unit}</span>
                            </p>
                            {plan.name_en && (
                              <p className="text-[9px] text-muted-foreground truncate" dir="ltr">{plan.name_en}</p>
                            )}
                          </div>
                        </div>

                        {/* Price + duration */}
                        <div className="text-center leading-tight">
                          {yearlyUnavailable ? (
                            <span className="text-[10px] text-muted-foreground">غير متاح سنوياً</span>
                          ) : (
                            <>
                              <span className={`text-base font-bold ${accent.text}`}>
                                {Number(planPrice ?? 0).toFixed(0)}
                              </span>
                              <span className="text-[9px] text-muted-foreground ms-0.5">{plan.currency}</span>
                              <span className="text-[9px] text-muted-foreground block">
                                / {duration === 'monthly' ? 'شهرياً' : 'سنوياً'}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Action area */}
                        {isCurrent ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 w-full justify-center py-1 text-[9px]">
                            <CheckCircle2 className="h-3 w-3 me-0.5" />
                            {status.active_upgrade?.duration_type === 'permanent'
                              ? 'خطتك الحالية · دائمة'
                              : expiryDaysLeft != null
                                ? `خطتك الحالية · ${expiryDaysLeft} يوم`
                                : 'خطتك الحالية'}
                          </Badge>
                        ) : isSubmitted ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 w-full justify-center py-1 text-[9px]">
                            <Clock className="h-3 w-3 me-0.5" />
                            تم إرسال الطلب
                          </Badge>
                        ) : isSmaller ? (
                          <Badge variant="outline" className="bg-muted text-muted-foreground border-border w-full justify-center py-1 text-[9px]">
                            أقل من خطتك الحالية
                          </Badge>
                        ) : yearlyUnavailable ? (
                          <Badge variant="outline" className="bg-muted text-muted-foreground border-border w-full justify-center py-1 text-[9px]">
                            شهري فقط
                          </Badge>
                        ) : (
                          <Button
                            className={`w-full h-7 text-[10px] gap-1 ${accent.btn}`}
                            size="sm"
                            disabled={submitting === plan.id}
                            onClick={() => handleSubscribe(plan)}
                          >
                            {submitting === plan.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <><Plus className="h-3 w-3" />{isRenewal ? 'تجديد' : 'اشترك'}</>}
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
            </div>
          </DialogScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
