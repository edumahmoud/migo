'use client';

/**
 * AdminPaidServicesSection — v134
 *
 * The admin's "paid services" section. 5 tabs:
 *   1. طلبات التفعيل — list of activation requests (approve/reject/assign)
 *   2. التفعيلات النشطة — active unlocks + manual grant + revoke
 *   3. إعدادات القفل — per-section config (lock/unlock, pricing, limits)
 *   4. الفتح المؤقت — global trials (all / new_users)
 *   5. المشرفون — (superadmin only) assign admins to sections
 *
 * All admins can see tabs 1-2. Only superadmin can see tabs 3-5.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Lock, Unlock, Clock, Settings, Gift, Users, Check, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';

type RequestRow = {
  id: string; user_id: string; user_role: string; section_key: string;
  plan_type: string; user_name: string | null; user_email: string | null;
  user_phone: string | null; notes: string | null; status: string;
  assigned_to: string | null; created_at: string; processed_at: string | null;
};

type ConfigRow = {
  id: string; section_key: string; section_label: string;
  student_locked: boolean; teacher_locked: boolean;
  student_monthly_price: number; student_yearly_price: number;
  teacher_monthly_price: number; teacher_yearly_price: number;
  currency: string; student_max_usage: number | null; teacher_max_usage: number | null;
  usage_period_days: number; usage_metric: string | null; is_active: boolean;
};

type UnlockRow = {
  id: string; user_id: string; section_key: string; plan_type: string;
  started_at: string; expires_at: string; activation_method: string;
  is_active: boolean; user: { name: string | null; email: string; role: string } | null;
};

type TrialRow = {
  id: string; section_key: string; scope: string; duration_days: number;
  started_at: string; expires_at: string; is_active: boolean;
};

export default function AdminPaidServicesSection() {
  const { direction } = useTranslations();
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'superadmin';
  const { confirmDialog, confirm } = useConfirmDialog();

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [unlocks, setUnlocks] = useState<UnlockRow[]>([]);
  const [trials, setTrials] = useState<TrialRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getCachedAuthHeaders();
      const [reqRes, cfgRes, unlRes, trlRes] = await Promise.all([
        fetch('/api/admin/paid-services/requests', { headers }),
        fetch('/api/admin/paid-services/config', { headers }),
        fetch('/api/admin/paid-services/unlocks', { headers }),
        fetch('/api/admin/paid-services/trial', { headers }),
      ]);
      const [reqJson, cfgJson, unlJson, trlJson] = await Promise.all([
        reqRes.json(), cfgRes.json(), unlRes.json(), trlRes.json(),
      ]);
      if (reqJson.success) setRequests(reqJson.requests);
      if (cfgJson.success) setConfigs(cfgJson.configs);
      if (unlJson.success) setUnlocks(unlJson.unlocks);
      if (trlJson.success) setTrials(trlJson.trials);
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── Request actions ───
  const handleApprove = async (req: RequestRow) => {
    const days = req.plan_type === 'yearly' ? 365 : 30;
    const ok = await confirm({
      title: 'تأكيد القبول',
      description: `تفعيل ${req.user_name || req.user_email} لقسم "${req.section_key}" لمدة ${days} يوماً (${req.plan_type === 'yearly' ? 'سنوي' : 'شهري'})`,
      confirmLabel: 'تفعيل', cancelLabel: 'إلغاء',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/paid-services/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ requestId: req.id, action: 'approve', durationDays: days }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تفعيل القسم للمستخدم');
        fetchAll();
      } else { toast.error(json.error || 'فشل'); }
    } catch { toast.error('حدث خطأ'); }
  };

  const handleReject = async (req: RequestRow) => {
    const ok = await confirm({
      title: 'تأكيد الرفض', description: `رفض طلب ${req.user_name || req.user_email}`,
      confirmLabel: 'رفض', cancelLabel: 'إلغاء', variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/paid-services/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ requestId: req.id, action: 'reject' }),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم رفض الطلب'); fetchAll(); }
      else { toast.error(json.error || 'فشل'); }
    } catch { toast.error('حدث خطأ'); }
  };

  // ─── Config update ───
  const updateConfig = async (sectionKey: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/admin/paid-services/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ sectionKey, updates }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحديث الإعدادات');
        setConfigs(prev => prev.map(c => c.section_key === sectionKey ? { ...c, ...updates } : c));
      } else { toast.error(json.error || 'فشل'); }
    } catch { toast.error('حدث خطأ'); }
  };

  // ─── Trial create ───
  const handleCreateTrial = async (sectionKey: string, scope: 'all' | 'new_users', days: number) => {
    try {
      const res = await fetch('/api/admin/paid-services/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ sectionKey, scope, durationDays: days }),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم إنشاء الفتح المؤقت'); fetchAll(); }
      else { toast.error(json.error || 'فشل'); }
    } catch { toast.error('حدث خطأ'); }
  };

  const handleRevokeTrial = async (trialId: string) => {
    try {
      const res = await fetch('/api/admin/paid-services/trial', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ trialId }),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم إلغاء الفتح المؤقت'); fetchAll(); }
      else { toast.error(json.error || 'فشل'); }
    } catch { toast.error('حدث خطأ'); }
  };

  // ─── Revoke unlock ───
  const handleRevokeUnlock = async (unlockId: string) => {
    const ok = await confirm({
      title: 'إلغاء التفعيل', description: 'سيتم إلغاء تفعيل القسم لهذا المستخدم فوراً',
      confirmLabel: 'إلغاء التفعيل', cancelLabel: 'تراجع', variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/paid-services/unlocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ unlockId }),
      });
      const json = await res.json();
      if (json.success) { toast.success('تم إلغاء التفعيل'); fetchAll(); }
      else { toast.error(json.error || 'فشل'); }
    } catch { toast.error('حدث خطأ'); }
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-4" dir={direction}>
      {confirmDialog}
      <Tabs defaultValue="requests">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="requests" className="text-xs gap-1">
            <Clock className="h-3.5 w-3.5" />
            طلبات التفعيل ({pendingRequests.length})
          </TabsTrigger>
          <TabsTrigger value="unlocks" className="text-xs gap-1">
            <Unlock className="h-3.5 w-3.5" />
            التفعيلات النشطة
          </TabsTrigger>
          {isSuperAdmin && (
            <>
              <TabsTrigger value="config" className="text-xs gap-1">
                <Settings className="h-3.5 w-3.5" />
                إعدادات القفل
              </TabsTrigger>
              <TabsTrigger value="trial" className="text-xs gap-1">
                <Gift className="h-3.5 w-3.5" />
                الفتح المؤقت
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ─── Tab 1: Requests ─── */}
        <TabsContent value="requests">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">طلبات التفعيل ({requests.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {requests.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">لا توجد طلبات</div>
              ) : (
                <div className="divide-y max-h-[600px] overflow-y-auto">
                  {requests.map(r => (
                    <div key={r.id} className="p-3 text-xs space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium">{r.user_name || '—'}</span>
                            <Badge variant="secondary" className="text-[9px]">{r.user_role === 'student' ? 'طالب' : 'معلم'}</Badge>
                            <Badge variant="outline" className="text-[9px]">{r.section_key}</Badge>
                            <Badge variant="outline" className="text-[9px]">{r.plan_type === 'yearly' ? 'سنوي' : 'شهري'}</Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0.5">
                            <div dir="ltr" className="text-start">{r.user_email}</div>
                            {r.user_phone && <div dir="ltr" className="text-start">📱 {r.user_phone}</div>}
                            <div>{formatDate(r.created_at)}</div>
                            {r.notes && <div className="mt-1 italic">"{r.notes}"</div>}
                          </div>
                        </div>
                        <Badge variant={
                          r.status === 'pending' ? 'outline' :
                          r.status === 'approved' ? 'default' : 'destructive'
                        } className="text-[9px] shrink-0">
                          {r.status === 'pending' ? 'معلّق' : r.status === 'approved' ? 'مقبول' : 'مرفوض'}
                        </Badge>
                      </div>
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-1.5 pt-1 border-t">
                          <Button size="sm" variant="outline" className="h-7 text-[10px] border-emerald-300 text-emerald-700"
                            onClick={() => handleApprove(r)}>
                            <Check className="h-3 w-3 me-1" /> قبول
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-[10px] text-rose-600"
                            onClick={() => handleReject(r)}>
                            <X className="h-3 w-3 me-1" /> رفض
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab 2: Unlocks ─── */}
        <TabsContent value="unlocks">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">التفعيلات النشطة ({unlocks.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {unlocks.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">لا توجد تفعيلات نشطة</div>
              ) : (
                <div className="divide-y max-h-[600px] overflow-y-auto">
                  {unlocks.map(u => (
                    <div key={u.id} className="p-3 text-xs flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium">{u.user?.name || '—'}</span>
                          <Badge variant="secondary" className="text-[9px]">{u.user?.role}</Badge>
                          <Badge variant="outline" className="text-[9px]">{u.section_key}</Badge>
                          <Badge variant="outline" className="text-[9px]">
                            {u.plan_type === 'yearly' ? 'سنوي' : u.plan_type === 'monthly' ? 'شهري' : 'تجربة'}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {u.user?.email} · ينتهي: {formatDate(u.expires_at)}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-600"
                        onClick={() => handleRevokeUnlock(u.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab 3: Config (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="config">
            <div className="space-y-3">
              {/* Help banner */}
              <div className="rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-3 text-xs text-sky-700 dark:text-sky-300 space-y-1">
                <p className="font-medium">دليل الإعدادات</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  <li><b>قفل القسم</b>: فعّل القفل ليصبح القسم مدفوعاً للمستخدمين</li>
                  <li><b>الأسعار</b>: حدد سعر الاشتراك الشهري والسنوي لكل دور (بالعملة المحددة)</li>
                  <li><b>حد الاستخدام</b>: الحد الأقصى للعمليات خلال فترة الاشتراك — اتركه فارغاً لـ "غير محدود"</li>
                  <li><b>الحدود الافتراضية</b>: تُطبق دائماً حتى لو لم يُفعّل القفل (مثل حصة التخزين للملفات)</li>
                </ul>
              </div>

              {configs.map(c => {
                const isStorage = c.usage_metric === 'storage';
                const isCombined = c.usage_metric === 'combined';
                const metricLabel = isStorage
                  ? 'ميجابايت'
                  : isCombined
                    ? 'عملية (تلخيص + اختبار ذكي)'
                    : 'عملية';
                const metricDesc = isStorage
                  ? 'إجمالي مساحة الملفات المرفوعة'
                  : isCombined
                    ? 'يشمل الملخصات والاختبارات المُولّدة بالذكاء الاصطناعي'
                    : '';

                return (
                  <Card key={c.id} className={c.student_locked || c.teacher_locked ? 'border-amber-300' : ''}>
                    <CardContent className="p-4 space-y-3">
                      {/* Section header */}
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{c.section_label}</p>
                          {metricDesc && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{metricDesc}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {c.student_locked && (
                            <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                              مقفل للطلاب
                            </Badge>
                          )}
                          {c.teacher_locked && (
                            <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                              مقفل للمعلمين
                            </Badge>
                          )}
                          {!c.student_locked && !c.teacher_locked && (
                            <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              مفتوح
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Lock toggles */}
                      <div className="grid grid-cols-2 gap-2">
                        <label className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                          c.student_locked ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border'
                        }`}>
                          <input
                            type="checkbox"
                            checked={c.student_locked}
                            onChange={(e) => updateConfig(c.section_key, { student_locked: e.target.checked })}
                            className="h-4 w-4"
                          />
                          <div>
                            <span className="text-xs font-medium">قفل للطلاب</span>
                            <p className="text-[10px] text-muted-foreground">يصبح القسم مدفوعاً للطلاب</p>
                          </div>
                        </label>
                        <label className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                          c.teacher_locked ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border'
                        }`}>
                          <input
                            type="checkbox"
                            checked={c.teacher_locked}
                            onChange={(e) => updateConfig(c.section_key, { teacher_locked: e.target.checked })}
                            className="h-4 w-4"
                          />
                          <div>
                            <span className="text-xs font-medium">قفل للمعلمين</span>
                            <p className="text-[10px] text-muted-foreground">يصبح القسم مدفوعاً للمعلمين</p>
                          </div>
                        </label>
                      </div>

                      {/* Pricing — always visible */}
                      <div className="border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">الأسعار ({c.currency})</p>
                        <div className="grid grid-cols-2 gap-3">
                          {/* Student pricing */}
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-medium text-sky-700 dark:text-sky-400">الطالب</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <Label className="text-[10px] text-muted-foreground">شهري</Label>
                                <Input
                                  type="number"
                                  defaultValue={c.student_monthly_price}
                                  onBlur={(e) => updateConfig(c.section_key, { student_monthly_price: Number(e.target.value) })}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                  dir="ltr"
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] text-muted-foreground">سنوي</Label>
                                <Input
                                  type="number"
                                  defaultValue={c.student_yearly_price}
                                  onBlur={(e) => updateConfig(c.section_key, { student_yearly_price: Number(e.target.value) })}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                  dir="ltr"
                                />
                              </div>
                            </div>
                          </div>
                          {/* Teacher pricing */}
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-medium text-teal-700 dark:text-teal-400">المعلم</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <Label className="text-[10px] text-muted-foreground">شهري</Label>
                                <Input
                                  type="number"
                                  defaultValue={c.teacher_monthly_price}
                                  onBlur={(e) => updateConfig(c.section_key, { teacher_monthly_price: Number(e.target.value) })}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                  dir="ltr"
                                />
                              </div>
                              <div>
                                <Label className="text-[10px] text-muted-foreground">سنوي</Label>
                                <Input
                                  type="number"
                                  defaultValue={c.teacher_yearly_price}
                                  onBlur={(e) => updateConfig(c.section_key, { teacher_yearly_price: Number(e.target.value) })}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                  dir="ltr"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Usage limits — always visible (even when not locked) */}
                      {c.usage_metric && (
                        <div className="border-t pt-3">
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            حد الاستخدام (يُطبق دائماً)
                          </p>
                          <p className="text-[10px] text-muted-foreground mb-2">
                            الوحدة: {metricLabel} — اتركه فارغاً لـ "غير محدود"
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label className="text-[10px] font-medium text-sky-700 dark:text-sky-400">حد الطالب</Label>
                              <Input
                                type="number"
                                defaultValue={c.student_max_usage ?? ''}
                                onBlur={(e) => updateConfig(c.section_key, { student_max_usage: e.target.value ? Number(e.target.value) : null })}
                                className="h-8 text-xs"
                                placeholder="غير محدود"
                                dir="ltr"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] font-medium text-teal-700 dark:text-teal-400">حد المعلم</Label>
                              <Input
                                type="number"
                                defaultValue={c.teacher_max_usage ?? ''}
                                onBlur={(e) => updateConfig(c.section_key, { teacher_max_usage: e.target.value ? Number(e.target.value) : null })}
                                className="h-8 text-xs"
                                placeholder="غير محدود"
                                dir="ltr"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        )}

        {/* ─── Tab 4: Trial (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="trial">
            <TrialManager configs={configs} trials={trials} onCreate={handleCreateTrial} onRevoke={handleRevokeTrial} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Trial Manager sub-component ───
function TrialManager({
  configs, trials, onCreate, onRevoke,
}: {
  configs: ConfigRow[];
  trials: TrialRow[];
  onCreate: (sectionKey: string, scope: 'all' | 'new_users', days: number) => void;
  onRevoke: (trialId: string) => void;
}) {
  const [sectionKey, setSectionKey] = useState('');
  const [scope, setScope] = useState<'all' | 'new_users'>('all');
  const [days, setDays] = useState('7');

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader><CardTitle className="text-sm">إنشاء فتح مؤقت</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Select value={sectionKey} onValueChange={setSectionKey}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="اختر القسم" /></SelectTrigger>
            <SelectContent>
              {configs.filter(c => c.is_active).map(c => (
                <SelectItem key={c.section_key} value={c.section_key}>{c.section_label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={(v) => setScope(v as 'all' | 'new_users')}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">للجميع</SelectItem>
              <SelectItem value="new_users">للحسابات الجديدة فقط</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="عدد الأيام" className="h-8 text-xs" />
          <Button
            size="sm"
            disabled={!sectionKey || !days}
            onClick={() => onCreate(sectionKey, scope, Number(days))}
            className="w-full"
          >
            <Gift className="h-4 w-4 me-1" /> فتح مؤقت
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">الفتح المؤقت الحالي ({trials.filter(t => t.is_active).length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {trials.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">لا يوجد فتح مؤقت</div>
          ) : (
            <div className="divide-y">
              {trials.map(t => (
                <div key={t.id} className="p-2.5 text-xs flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{t.section_key}</span>
                      <Badge variant="outline" className="text-[9px]">{t.scope === 'all' ? 'للجميع' : 'للجدد'}</Badge>
                      {!t.is_active && <Badge variant="secondary" className="text-[9px]">منتهي</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDate(t.started_at)} → {formatDate(t.expires_at)}
                    </div>
                  </div>
                  {t.is_active && (
                    <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-600"
                      onClick={() => onRevoke(t.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
