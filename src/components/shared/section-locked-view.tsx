'use client';

/**
 * SectionLockedView — v134h
 *
 * v134h changes:
 *   - For storage sections (files): show "شراء مساحة" instead of
 *     monthly/yearly subscription plans. The user buys a storage quota,
 *     not a time-based subscription.
 *   - Fix: when an approved request's unlock has EXPIRED, show the
 *     activation form again (not the "you can use it" message).
 *   - The "approved" state only shows when the user has an ACTIVE unlock.
 */

import { useState, useEffect } from 'react';
import { Lock, Loader2, CheckCircle2, Clock, XCircle, Sparkles, HardDrive, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface SectionConfig {
  section_label: string;
  student_monthly_price: number;
  student_yearly_price: number;
  teacher_monthly_price: number;
  teacher_yearly_price: number;
  currency: string;
  student_monthly_limit: number | null;
  student_yearly_limit: number | null;
  teacher_monthly_limit: number | null;
  teacher_yearly_limit: number | null;
  usage_period_days: number;
  usage_metric: string | null;
}

interface Props {
  sectionKey: string;
  sectionLabel: string;
  config: SectionConfig;
  userRole: 'student' | 'teacher';
  onRequestSubmitted?: () => void;
}

/** Format the savings text in proper Arabic. */
function formatSavings(yearlyPrice: number, monthlyPrice: number): string {
  if (monthlyPrice <= 0 || yearlyPrice <= 0) return '';
  const monthlyTotal = monthlyPrice * 12;
  if (yearlyPrice >= monthlyTotal) return '';
  const saved = monthlyTotal - yearlyPrice;
  const savedMonths = Math.round(saved / monthlyPrice);
  if (savedMonths === 1) return '(وفًر شهر)';
  if (savedMonths === 2) return '(وفًر شهرين)';
  if (savedMonths >= 3 && savedMonths <= 10) return `(وفًر ${savedMonths} أشهر)`;
  if (savedMonths > 10) return `(وفًر ${savedMonths} شهر)`;
  return '';
}

export default function SectionLockedView({
  sectionKey,
  sectionLabel,
  config,
  userRole,
  onRequestSubmitted,
}: Props) {
  const { direction } = useTranslations();
  const isStorage = config.usage_metric === 'storage';
  const [planType, setPlanType] = useState<'monthly' | 'yearly'>('monthly');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [existingRequest, setExistingRequest] = useState<{
    status: string;
    plan_type: string;
    created_at: string;
  } | null>(null);
  // v134h: track whether the user's unlock is still active.
  const [unlockActive, setUnlockActive] = useState(false);

  // Fetch existing requests + unlock status for this section.
  useEffect(() => {
    (async () => {
      try {
        // Fetch requests.
        const reqRes = await fetch('/api/sections/activation-request', {
          headers: await getCachedAuthHeaders(),
        });
        const reqJson = await reqRes.json();
        if (reqJson.success) {
          const found = (reqJson.requests as Array<{
            section_key: string;
            status: string;
            plan_type: string;
            created_at: string;
          }>)?.find(r => r.section_key === sectionKey);
          if (found) {
            setExistingRequest({
              status: found.status,
              plan_type: found.plan_type,
              created_at: found.created_at,
            });
          }
        }

        // v134h: also fetch the locked-status to check if unlock is active.
        const statusRes = await fetch('/api/sections/locked-status', {
          headers: await getCachedAuthHeaders(),
        });
        const statusJson = await statusRes.json();
        if (statusJson.success && statusJson.sections[sectionKey]) {
          setUnlockActive(statusJson.sections[sectionKey].unlocked);
        }
      } catch {
        // Silent
      }
    })();
  }, [sectionKey]);

  const monthlyPrice = userRole === 'student'
    ? config.student_monthly_price
    : config.teacher_monthly_price;
  const yearlyPrice = userRole === 'student'
    ? config.student_yearly_price
    : config.teacher_yearly_price;
  const savingsText = formatSavings(Number(yearlyPrice), Number(monthlyPrice));

  // v134g: dynamic usage limit based on the SELECTED PLAN + role.
  const usageLimit = userRole === 'student'
    ? (planType === 'yearly' ? config.student_yearly_limit : config.student_monthly_limit)
    : (planType === 'yearly' ? config.teacher_yearly_limit : config.teacher_monthly_limit);

  // v134h: for storage sections, use monthly_limit as the quota (not per-plan).
  const storageQuota = userRole === 'student'
    ? config.student_monthly_limit
    : config.teacher_monthly_limit;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/sections/activation-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ sectionKey, planType, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إرسال طلب التفعيل. سيتم التواصل معك قريباً.');
        setExistingRequest({ status: 'pending', plan_type: planType, created_at: new Date().toISOString() });
        onRequestSubmitted?.();
      } else {
        const errMsg = json.error || 'فشل إرسال الطلب';
        toast.error(errMsg);
        console.error('[SectionLockedView] submit error:', json);
      }
    } catch (err) {
      console.error('[SectionLockedView] network error:', err);
      toast.error('حدث خطأ غير متوقع أثناء إرسال الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><Clock className="h-3 w-3 me-1" />قيد المراجعة</Badge>;
      case 'approved':
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="h-3 w-3 me-1" />مقبول</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200"><XCircle className="h-3 w-3 me-1" />مرفوض</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // v134h: determine what to show.
  // - If the user has an ACTIVE unlock → show "activated" state.
  // - If they have a PENDING request → show "pending" state.
  // - If they have an APPROVED request but unlock EXPIRED → show the form again.
  // - If no request or rejected → show the form.
  const showActivated = unlockActive;
  const showPending = existingRequest?.status === 'pending' && !unlockActive;
  const showForm = !showActivated && !showPending;

  return (
    <div className="flex items-center justify-center py-12 px-4" dir={direction}>
      <div className="w-full max-w-lg space-y-4">
        {/* Header */}
        <Card className="border-amber-200 dark:border-amber-900/60">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/30">
              {isStorage ? <HardDrive className="h-8 w-8 text-white" /> : <Lock className="h-8 w-8 text-white" />}
            </div>
            <CardTitle className="text-xl">{sectionLabel}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {isStorage
                ? 'هذا القسم يتطلب شراء مساحة تخزينية.'
                : 'هذا القسم ميزة مدفوعة. اختر خطة التفعيل المناسبة لك.'}
            </p>
          </CardHeader>
        </Card>

        {/* ─── Activated state ─── */}
        {showActivated && (
          <Card className="border-emerald-200 dark:border-emerald-900/60">
            <CardContent className="p-6 text-center space-y-2">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
              <p className="font-medium text-emerald-700 dark:text-emerald-400">القسم مفعّل</p>
              <p className="text-xs text-muted-foreground">يمكنك الآن استخدام هذا القسم.</p>
            </CardContent>
          </Card>
        )}

        {/* ─── Pending state ─── */}
        {showPending && (
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">طلبك قيد المراجعة</p>
                <p className="text-xs text-muted-foreground">
                  الخطة: {existingRequest?.plan_type === 'yearly' ? 'سنوي' : isStorage ? 'مساحة' : 'شهري'}
                </p>
              </div>
              {statusBadge('pending')}
            </CardContent>
          </Card>
        )}

        {/* ─── Form (when not activated and not pending) ─── */}
        {showForm && (
          <>
            {/* Previous rejected request */}
            {existingRequest?.status === 'rejected' && (
              <Card>
                <CardContent className="p-4 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">طلبك السابق</p>
                    <p className="text-xs text-muted-foreground">تم رفضه — يمكنك إرسال طلب جديد</p>
                  </div>
                  {statusBadge('rejected')}
                </CardContent>
              </Card>
            )}

            {/* v134h: for storage sections — show storage upgrade plans */}
            {isStorage ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-sky-600" />
                    تزويد مساحة التخزين
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>مساحة التخزين ممتلئة. اختر خطة لتزويد المساحة:</span>
                  </div>
                  {/* Monthly upgrade */}
                  <button
                    type="button"
                    onClick={() => setPlanType('monthly')}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors ${
                      planType === 'monthly'
                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-sm">خطة شهرية</div>
                      <div className="text-[11px] text-muted-foreground">
                        {storageQuota ?? 'غير محدود'} ميجابايت · 30 يوماً
                      </div>
                    </div>
                    <div className="font-bold text-amber-700 dark:text-amber-400">
                      {Number(monthlyPrice).toFixed(0)} {config.currency}
                    </div>
                  </button>
                  {/* Yearly upgrade */}
                  <button
                    type="button"
                    onClick={() => setPlanType('yearly')}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors ${
                      planType === 'yearly'
                        ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-sm">خطة سنوية</div>
                      <div className="text-[11px] text-muted-foreground">
                        {storageQuota ?? 'غير محدود'} ميجابايت · 365 يوماً {savingsText}
                      </div>
                    </div>
                    <div className="font-bold text-amber-700 dark:text-amber-400">
                      {Number(yearlyPrice).toFixed(0)} {config.currency}
                    </div>
                  </button>
                  <div className="rounded-md bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-3 text-xs text-sky-700 dark:text-sky-300">
                    تشمل المساحة جميع الملفات المرفوعة. المحذوفة محسوبة من الإجمالي.
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Plan selection (monthly/yearly) — for non-storage sections */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-600" />
                      اختر الخطة
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setPlanType('monthly')}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors ${
                        planType === 'monthly'
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-sm">اشتراك شهري</div>
                        <div className="text-[11px] text-muted-foreground">
                          {usageLimit ? `${usageLimit} عملية` : 'غير محدود'} · 30 يوماً
                        </div>
                      </div>
                      <div className="font-bold text-amber-700 dark:text-amber-400">
                        {Number(monthlyPrice).toFixed(0)} {config.currency}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlanType('yearly')}
                      className={`w-full flex items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors ${
                        planType === 'yearly'
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-sm">اشتراك سنوي</div>
                        <div className="text-[11px] text-muted-foreground">
                          {usageLimit ? `${usageLimit} عملية` : 'غير محدود'} · 365 يوماً {savingsText}
                        </div>
                      </div>
                      <div className="font-bold text-amber-700 dark:text-amber-400">
                        {Number(yearlyPrice).toFixed(0)} {config.currency}
                      </div>
                    </button>
                  </CardContent>
                </Card>
              </>
            )}

            {/* Request form */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">بيانات طلب التفعيل</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-3 text-xs text-sky-700 dark:text-sky-300">
                  سيتم إرسال طلبك لإدارة المنصة. سيتواصل معك فريق الدعم لإتمام التفعيل بعد تأكيد الدفع.
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">ملاحظات (اختياري)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي ملاحظات تريد إرسالها للإدارة..."
                    rows={2}
                    maxLength={500}
                  />
                </div>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {submitting ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Lock className="h-4 w-4 me-1" />}
                  {isStorage
                    ? `إرسال طلب تزويد المساحة (${planType === 'yearly' ? 'سنوي' : 'شهري'})`
                    : `إرسال طلب التفعيل (${planType === 'yearly' ? 'سنوي' : 'شهري'})`}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  سيتم استخدام بيانات حسابك (الاسم، البريد، الهاتف) تلقائياً في الطلب.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
