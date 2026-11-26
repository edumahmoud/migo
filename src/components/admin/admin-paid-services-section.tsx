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
import { Loader2, Lock, Unlock, Clock, Settings, Gift, Users, Check, X, Trash2, HardDrive, Plus, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useTranslations } from '@/i18n/use-translations';
import { useAuthStore } from '@/stores/auth-store';
import MascotLoader from '@/components/shared/mascot-loader';

type RequestRow = {
  id: string; user_id: string; user_role: string; section_key: string;
  plan_type: string; user_name: string | null; user_email: string | null;
  user_phone: string | null; notes: string | null; status: string;
  assigned_to: string | null; created_at: string; processed_at: string | null;
  request_type?: string | null; plan?: { name: string; size_mb: number } | null;
};

type ConfigRow = {
  id: string; section_key: string; section_label: string;
  student_locked: boolean; teacher_locked: boolean;
  student_monthly_price: number; student_yearly_price: number;
  teacher_monthly_price: number; teacher_yearly_price: number;
  currency: string;
  student_monthly_limit: number | null; student_yearly_limit: number | null;
  teacher_monthly_limit: number | null; teacher_yearly_limit: number | null;
  usage_period_days: number; usage_metric: string | null; is_active: boolean;
  teacher_only?: boolean;
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
  const { direction, t } = useTranslations();
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'superadmin';
  const { confirmDialog, confirm } = useConfirmDialog();

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [configs, setConfigs] = useState<ConfigRow[]>([]);
  const [unlocks, setUnlocks] = useState<UnlockRow[]>([]);
  const [trials, setTrials] = useState<TrialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reqFilter, setReqFilter] = useState<'pending' | 'all'>('pending');

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
      if (!reqJson.success || !unlJson.success) toast.error(reqJson.error || unlJson.error || t('paidServices.failed'));
      if (reqJson.success) setRequests(reqJson.requests);
      if (cfgJson.success) setConfigs(cfgJson.configs);
      if (unlJson.success) setUnlocks(unlJson.unlocks);
      if (trlJson.success) setTrials(trlJson.trials);
    } catch {
      toast.error(t('paidServices.unexpected'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── Request actions ───
  const handleApprove = async (req: RequestRow) => {
    const days = req.plan_type === 'yearly' ? 365 : 30;
    const ok = await confirm({
      title: t('paidServices.approveConfirmTitle'),
      description: t('paidServices.approveConfirmDesc', {
        name: req.user_name || req.user_email || '',
        section: req.section_key,
        days: t('paidServices.daysCount', { count: days }),
        plan: req.plan_type === 'yearly' ? t('paidServices.planYearly') : t('paidServices.planMonthly'),
      }),
      confirmLabel: t('paidServices.activate'), cancelLabel: t('common.cancel'),
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
        toast.success(t('paidServices.approveSuccess'));
        fetchAll();
      } else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
  };

  const handleReject = async (req: RequestRow) => {
    const ok = await confirm({
      title: t('paidServices.rejectConfirmTitle'), description: t('paidServices.rejectConfirmDesc', { name: req.user_name || req.user_email || '' }),
      confirmLabel: t('paidServices.rejectLabel'), cancelLabel: t('common.cancel'), variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/paid-services/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ requestId: req.id, action: 'reject' }),
      });
      const json = await res.json();
      if (json.success) { toast.success(t('paidServices.rejectSuccess')); fetchAll(); }
      else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
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
        toast.success(t('paidServices.settingsSaved'));
        setConfigs(prev => prev.map(c => c.section_key === sectionKey ? { ...c, ...updates } : c));
      } else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
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
      if (json.success) { toast.success(t('paidServices.trialCreated')); fetchAll(); }
      else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
  };

  const handleRevokeTrial = async (trialId: string) => {
    try {
      const res = await fetch('/api/admin/paid-services/trial', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ trialId }),
      });
      const json = await res.json();
      if (json.success) { toast.success(t('paidServices.trialRevoked')); fetchAll(); }
      else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
  };

  // ─── Revoke unlock ───
  const handleRevokeUnlock = async (unlockId: string) => {
    const ok = await confirm({
      title: t('paidServices.deactivateConfirmTitle'), description: t('paidServices.deactivateConfirmDesc'),
      confirmLabel: t('paidServices.deactivateLabel'), cancelLabel: t('common.back'), variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/paid-services/unlocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ unlockId }),
      });
      const json = await res.json();
      if (json.success) { toast.success(t('paidServices.deactivateSuccess')); fetchAll(); }
      else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return '—'; }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <MascotLoader kind="ai" size={96} />
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
            {t('nav.paidServicesRequests')} ({pendingRequests.length})
          </TabsTrigger>
          <TabsTrigger value="unlocks" className="text-xs gap-1">
            <Unlock className="h-3.5 w-3.5" />
            {t('nav.paidServicesUnlocks')}
          </TabsTrigger>
          {isSuperAdmin && (
            <>
              <TabsTrigger value="trial" className="text-xs gap-1">
                <Gift className="h-3.5 w-3.5" />
                {t('nav.paidServicesTrial')}
              </TabsTrigger>
              <TabsTrigger value="storage" className="text-xs gap-1">
                <HardDrive className="h-3.5 w-3.5" />
                {t('nav.paidServicesStorage')}
              </TabsTrigger>
              <TabsTrigger value="summaries" className="text-xs gap-1">
                <Settings className="h-3.5 w-3.5" />
                {t('nav.paidServicesSummaries')}
              </TabsTrigger>
              <TabsTrigger value="questionBank" className="text-xs gap-1">
                <Settings className="h-3.5 w-3.5" />
                {t('nav.paidServicesQuestionBank')}
              </TabsTrigger>
              <TabsTrigger value="googleForms" className="text-xs gap-1">
                <Settings className="h-3.5 w-3.5" />
                {t('nav.paidServicesGoogleForms')}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ─── Tab 1: Requests ─── */}
        <TabsContent value="requests">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('paidServices.requestsTitle', { count: requests.length })}</CardTitle>
              <div className="flex gap-1.5 pt-1">
                <Button size="sm" variant={reqFilter === 'pending' ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setReqFilter('pending')}>
                  {t('paidServices.filterPending')} ({pendingRequests.length})
                </Button>
                <Button size="sm" variant={reqFilter === 'all' ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setReqFilter('all')}>
                  {t('paidServices.filterAll')} ({requests.length})
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {requests.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('paidServices.noRequests')}</div>
              ) : requests.filter(x => reqFilter === 'all' || x.status === 'pending').length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('paidServices.noRequests')}</div>
              ) : (
                <div className="divide-y max-h-[600px] overflow-y-auto">
                  {requests.filter(x => reqFilter === 'all' || x.status === 'pending').map(r => (
                    <div key={r.id} className="p-3 text-xs space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium">{r.user_name || '—'}</span>
                            <Badge variant="secondary" className="text-[9px]">{r.user_role === 'student' ? t('paidServices.roleStudent') : t('paidServices.roleTeacher')}</Badge>
                            <Badge variant="outline" className="text-[9px]">{r.request_type === 'storage_upgrade' ? `${t('paidServices.storageRequest')}${r.plan ? ': ' + r.plan.name : ''}` : r.section_key}</Badge>
                            <Badge variant="outline" className="text-[9px]">{r.plan_type === 'yearly' ? t('paidServices.planYearly') : t('paidServices.planMonthly')}</Badge>
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
                          {r.status === 'pending' ? t('paidServices.statusPending') : r.status === 'approved' ? t('paidServices.statusApproved') : t('paidServices.statusRejected')}
                        </Badge>
                      </div>
                      {r.status === 'pending' && (
                        <div className="flex items-center gap-1.5 pt-1 border-t">
                          <Button size="sm" variant="outline" className="h-7 text-[10px] border-emerald-300 text-emerald-700"
                            onClick={() => handleApprove(r)}>
                            <Check className="h-3 w-3 me-1" /> {t('paidServices.approve')}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-[10px] text-rose-600"
                            onClick={() => handleReject(r)}>
                            <X className="h-3 w-3 me-1" /> {t('paidServices.reject')}
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
              <CardTitle className="text-sm">{t('paidServices.unlocksTitle', { count: unlocks.length })}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {unlocks.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t('paidServices.noUnlocks')}</div>
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
                            {u.plan_type === 'yearly' ? t('paidServices.planYearly') : u.plan_type === 'monthly' ? t('paidServices.planMonthly') : t('paidServices.planTrial')}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {u.user?.email} · {t('paidServices.expires', { date: formatDate(u.expires_at) })}
                          {new Date(u.expires_at).getTime() < Date.now() && <Badge variant="secondary" className="text-[9px] ms-1">{t('paidServices.expired')}</Badge>}
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

        {/* ─── Tab: Summaries (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="summaries">
            <SectionConfigCard
              config={configs.find(c => c.section_key === 'summaries')}
              updateConfig={updateConfig}
              title={t('paidServices.summaryTitle')}
              description={t('paidServices.summaryDesc')}
              metricLabel={t('paidServices.summaryMetric')}
            />
          </TabsContent>
        )}

        {/* ─── Tab: Question Bank AI (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="questionBank">
            <SectionConfigCard
              config={configs.find(c => c.section_key === 'questionBankAI')}
              updateConfig={updateConfig}
              title={t('paidServices.aiQuestionsTitle')}
              description={t('paidServices.aiQuestionsDesc')}
              metricLabel={t('paidServices.aiQuestionsMetric')}
              teacherOnly
            />
          </TabsContent>
        )}

        {/* ─── Tab: Google Forms (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="googleForms">
            <SectionConfigCard
              config={configs.find(c => c.section_key === 'googleForms')}
              updateConfig={updateConfig}
              title={t('paidServices.gformsTitle')}
              description={t('paidServices.gformsDesc')}
              metricLabel=""
              teacherOnly
              noMetric
            />
          </TabsContent>
        )}

        {/* ─── Tab 4: Trial (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="trial">
            <TrialManager configs={configs} trials={trials} onCreate={handleCreateTrial} onRevoke={handleRevokeTrial} />
          </TabsContent>
        )}

        {/* ─── Tab 5: Storage Manager (superadmin only) ─── */}
        {isSuperAdmin && (
          <TabsContent value="storage">
            <StorageManager configs={configs} updateConfig={updateConfig} />
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
  const { t } = useTranslations();
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
        <CardHeader><CardTitle className="text-sm">{t('paidServices.createTrialTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Select value={sectionKey} onValueChange={setSectionKey}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('paidServices.selectSection')} /></SelectTrigger>
            <SelectContent>
              {configs.filter(c => c.is_active).map(c => (
                <SelectItem key={c.section_key} value={c.section_key}>{c.section_label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={scope} onValueChange={(v) => setScope(v as 'all' | 'new_users')}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('paidServices.scopeAll')}</SelectItem>
              <SelectItem value="new_users">{t('paidServices.scopeNew')}</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder={t('paidServices.daysPlaceholder')} className="h-8 text-xs" />
          <Button
            size="sm"
            disabled={!sectionKey || !days}
            onClick={() => {
              const n = Number(days);
              if (!Number.isInteger(n) || n < 1 || n > 365) { toast.error(t('paidServices.daysRange')); return; }
              onCreate(sectionKey, scope, n);
            }}
            className="w-full"
          >
            <Gift className="h-4 w-4 me-1" /> {t('paidServices.openTrial')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{t('paidServices.currentTrialsTitle', { count: trials.filter(tr => tr.is_active && new Date(tr.expires_at).getTime() > Date.now()).length })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {trials.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">{t('paidServices.noTrials')}</div>
          ) : (
            <div className="divide-y">
              {trials.map(tr => (
                <div key={tr.id} className="p-2.5 text-xs flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{tr.section_key}</span>
                      <Badge variant="outline" className="text-[9px]">{tr.scope === 'all' ? t('paidServices.scopeAll') : t('paidServices.scopeNewShort')}</Badge>
                      {(!tr.is_active || new Date(tr.expires_at).getTime() < Date.now()) && <Badge variant="secondary" className="text-[9px]">{tr.is_active ? t('paidServices.expired') : t('paidServices.revoked')}</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDate(tr.started_at)} → {formatDate(tr.expires_at)}
                    </div>
                  </div>
                  {tr.is_active && new Date(tr.expires_at).getTime() > Date.now() && (
                    <Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-600"
                      onClick={() => onRevoke(tr.id)}>
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

// ─── StorageManager — v134k (redesigned) ───
function StorageManager({
  configs,
  updateConfig,
}: {
  configs: ConfigRow[];
  updateConfig: (sectionKey: string, updates: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslations();
  const [plans, setPlans] = useState<Array<{
    id: string; name: string; name_en: string | null; size_mb: number;
    price: number; price_monthly: number | null; price_yearly: number | null;
    currency: string; is_active: boolean; sort_order: number;
  }>>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingPlan, setEditingPlan] = useState<typeof plans[number] | null>(null);
  const [newPlan, setNewPlan] = useState({ name: '', name_en: '', size_mb: '', price_monthly: '', price_yearly: '', currency: 'EGP' });
  const [editForm, setEditForm] = useState({ name: '', name_en: '', size_mb: '', price_monthly: '', price_yearly: '' });
  const [adding, setAdding] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [freeStudent, setFreeStudent] = useState('');
  const [freeTeacher, setFreeTeacher] = useState('');
  const [savingFree, setSavingFree] = useState(false);

  const filesConfig = configs.find(c => c.section_key === 'files');

  // v134l: init free quota fields from the role-aware columns first,
  // fall back to monthly_limit (pre-v134l databases).
  useEffect(() => {
    if (filesConfig) {
      const fc = filesConfig as Record<string, unknown>;
      const studentQuota =
        (fc.free_quota_mb_student as number | null) ??
        (fc.free_quota_mb as number | null) ??
        (fc.student_monthly_limit as number | null) ?? 100;
      const teacherQuota =
        (fc.free_quota_mb_teacher as number | null) ??
        (fc.teacher_monthly_limit as number | null) ?? 500;
      setFreeStudent(String(studentQuota));
      setFreeTeacher(String(teacherQuota));
    }
  }, [filesConfig]);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/storage-plans', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) setPlans(json.plans ?? []);
    } catch { /* silent */ }
    finally { setLoadingPlans(false); }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleSaveFree = async () => {
    if ([freeStudent, freeTeacher].some(v => v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0))) { toast.error(t('paidServices.invalidNumber')); return; }
    setSavingFree(true);
    try {
      await updateConfig('files', {
        student_monthly_limit: freeStudent ? Number(freeStudent) : null,
        student_yearly_limit: freeStudent ? Number(freeStudent) : null,
        teacher_monthly_limit: freeTeacher ? Number(freeTeacher) : null,
        teacher_yearly_limit: freeTeacher ? Number(freeTeacher) : null,
        // v134l: persist BOTH role-aware quotas. The previous code
        // only wrote free_quota_mb = freeStudent, which made the
        // teacher see the student's quota.
        free_quota_mb: freeStudent ? Number(freeStudent) : null,
        free_quota_mb_student: freeStudent ? Number(freeStudent) : null,
        free_quota_mb_teacher: freeTeacher ? Number(freeTeacher) : null,
      });
    } finally { setSavingFree(false); }
  };

  const handleAddPlan = async () => {
    if (!newPlan.name || !newPlan.size_mb || !newPlan.price_monthly) {
      toast.error(t('paidServices.planFieldsRequired'));
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/admin/storage-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({
          name: newPlan.name, name_en: newPlan.name_en || null,
          size_mb: Number(newPlan.size_mb),
          price_monthly: Number(newPlan.price_monthly),
          price_yearly: newPlan.price_yearly ? Number(newPlan.price_yearly) : null,
          currency: newPlan.currency, sort_order: plans.length + 1,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('paidServices.planAdded'));
        setNewPlan({ name: '', name_en: '', size_mb: '', price_monthly: '', price_yearly: '', currency: 'EGP' });
        setShowAddDialog(false);
        fetchPlans();
      } else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
    finally { setAdding(false); }
  };

  const handleDeletePlan = async (id: string) => {
    const ok = window.confirm(t('paidServices.deletePlanConfirm'));
    if (!ok) return;
    try {
      const res = await fetch('/api/admin/storage-plans', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (json.success) { toast.success(t('paidServices.planDeleted')); fetchPlans(); }
      else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
  };

  const handleTogglePlan = async (p: typeof plans[number]) => {
    try {
      const res = await fetch('/api/admin/storage-plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ id: p.id, updates: { is_active: !p.is_active } }),
      });
      const json = await res.json();
      if (json.success) { toast.success(t('paidServices.planToggled')); fetchPlans(); }
      else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
  };

  const openEditDialog = (plan: typeof plans[number]) => {
    setEditingPlan(plan);
    setEditForm({
      name: plan.name,
      name_en: plan.name_en ?? '',
      size_mb: String(plan.size_mb),
      price_monthly: String(plan.price_monthly ?? plan.price ?? 0),
      price_yearly: plan.price_yearly != null ? String(plan.price_yearly) : '',
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingPlan) return;
    if (!editForm.name || !editForm.size_mb || !editForm.price_monthly) {
      toast.error(t('paidServices.planFieldsRequired'));
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch('/api/admin/storage-plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({
          id: editingPlan.id,
          updates: {
            name: editForm.name,
            name_en: editForm.name_en || null,
            size_mb: Number(editForm.size_mb),
            price_monthly: Number(editForm.price_monthly),
            price_yearly: editForm.price_yearly ? Number(editForm.price_yearly) : null,
          },
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('paidServices.planUpdated'));
        setShowEditDialog(false);
        setEditingPlan(null);
        fetchPlans();
      } else { toast.error(json.error || t('paidServices.failed')); }
    } catch { toast.error(t('paidServices.error')); }
    finally { setSavingEdit(false); }
  };

  const formatSize = (mb: number) => {
    if (mb >= 1048576) return t('paidServices.sizeTb', { value: (mb / 1048576).toFixed(0) });
    if (mb >= 1024) return t('paidServices.sizeGb', { value: (mb / 1024).toFixed(0) });
    return t('paidServices.sizeMb', { value: mb });
  };

  return (
    <div className="space-y-3">
      {/* ─── Free Quota ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-emerald-600" />
            {t('paidServices.freeStorageTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            {t('paidServices.freeStorageDesc')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-medium text-sky-700">{t('paidServices.studentStorage')}</Label>
              <Input
                type="number"
                value={freeStudent}
                onChange={(e) => setFreeStudent(e.target.value)}
                className="h-8 text-xs"
                placeholder="100"
                dir="ltr"
              />
            </div>
            <div>
              <Label className="text-[10px] font-medium text-teal-700">{t('paidServices.teacherStorage')}</Label>
              <Input
                type="number"
                value={freeTeacher}
                onChange={(e) => setFreeTeacher(e.target.value)}
                className="h-8 text-xs"
                placeholder="500"
                dir="ltr"
              />
            </div>
          </div>
          <Button size="sm" className="w-full" disabled={savingFree} onClick={handleSaveFree}>
            {savingFree ? <Loader2 className="h-3 w-3 animate-spin me-1" /> : <Check className="h-3 w-3 me-1" />}
            {t('paidServices.saveFreeStorage')}
          </Button>
        </CardContent>
      </Card>

      {/* ─── Commercial Plans ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-sky-600" />
              {t('paidServices.plansTitle', { count: plans.length })}
            </CardTitle>
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setShowAddDialog(true)}>
              <Plus className="h-3 w-3 me-1" />
              {t('paidServices.addPlan')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingPlans ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-4 text-xs text-muted-foreground">{t('paidServices.noPlans')}</div>
          ) : (
            <div className="space-y-2">
              {plans.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <HardDrive className="h-4 w-4 text-sky-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium truncate">{p.name}</span>
                        {!p.is_active && <Badge variant="secondary" className="text-[9px]">{t('paidServices.planInactive')}</Badge>}
                        {p.name_en && <span className="text-[10px] text-muted-foreground">({p.name_en})</span>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatSize(p.size_mb)} · {t('paidServices.monthlyPrice', { price: Number(p.price_monthly ?? p.price).toFixed(0), currency: p.currency })}
                        {p.price_yearly != null && t('paidServices.yearlyPrice', { price: Number(p.price_yearly).toFixed(0), currency: p.currency })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" title={p.is_active ? t('paidServices.deactivatePlan') : t('paidServices.activatePlan')}
                      onClick={() => handleTogglePlan(p)}>
                      {p.is_active ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5"
                      onClick={() => openEditDialog(p)}>
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-rose-600 px-1.5"
                      onClick={() => handleDeletePlan(p.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Add Plan Dialog ─── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('paidServices.addPlanTitle')}</DialogTitle>
            <DialogDescription>{t('paidServices.addPlanDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs">{t('paidServices.planNameAr')}</Label>
              <Input value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                placeholder={t('paidServices.planNameArPlaceholder')} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">{t('paidServices.planNameEn')}</Label>
              <Input value={newPlan.name_en} onChange={(e) => setNewPlan({ ...newPlan, name_en: e.target.value })}
                placeholder="50 GB" className="h-8 text-xs" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">{t('paidServices.planSize')}</Label>
              <Input type="number" value={newPlan.size_mb}
                onChange={(e) => setNewPlan({ ...newPlan, size_mb: e.target.value })}
                placeholder="51200" className="h-8 text-xs" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">{t('paidServices.priceMonthly')}</Label>
              <Input type="number" value={newPlan.price_monthly}
                onChange={(e) => setNewPlan({ ...newPlan, price_monthly: e.target.value })}
                placeholder="20" className="h-8 text-xs" dir="ltr" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('paidServices.priceYearlyOptional')}</Label>
              <Input type="number" value={newPlan.price_yearly}
                onChange={(e) => setNewPlan({ ...newPlan, price_yearly: e.target.value })}
                placeholder="200" className="h-8 text-xs" dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowAddDialog(false)}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={adding} onClick={handleAddPlan}>
              {adding ? <Loader2 className="h-3 w-3 animate-spin me-1" /> : <Plus className="h-3 w-3 me-1" />}
              {t('paidServices.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit Plan Dialog ─── */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('paidServices.editPlanTitle')}</DialogTitle>
            <DialogDescription>{t('paidServices.editPlanDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div>
              <Label className="text-xs">{t('paidServices.planNameAr')}</Label>
              <Input value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">{t('paidServices.planNameEn')}</Label>
              <Input value={editForm.name_en}
                onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })}
                className="h-8 text-xs" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">{t('paidServices.planSize')}</Label>
              <Input type="number" value={editForm.size_mb}
                onChange={(e) => setEditForm({ ...editForm, size_mb: e.target.value })}
                className="h-8 text-xs" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">{t('paidServices.priceMonthly')}</Label>
              <Input type="number" value={editForm.price_monthly}
                onChange={(e) => setEditForm({ ...editForm, price_monthly: e.target.value })}
                className="h-8 text-xs" dir="ltr" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('paidServices.priceYearlyShort')}</Label>
              <Input type="number" value={editForm.price_yearly}
                onChange={(e) => setEditForm({ ...editForm, price_yearly: e.target.value })}
                placeholder={t('paidServices.priceYearlyPlaceholder')}
                className="h-8 text-xs" dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowEditDialog(false)}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={savingEdit} onClick={handleSaveEdit}>
              {savingEdit ? <Loader2 className="h-3 w-3 animate-spin me-1" /> : <Check className="h-3 w-3 me-1" />}
              {t('paidServices.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── SectionConfigCard — v134k ───
// A self-contained config card for a single section (summaries, questionBankAI, googleForms).
// Each section gets its own tab with this card inside.
function SectionConfigCard({
  config,
  updateConfig,
  title,
  description,
  metricLabel,
  teacherOnly = false,
  noMetric = false,
}: {
  config: ConfigRow | undefined;
  updateConfig: (sectionKey: string, updates: Record<string, unknown>) => Promise<void>;
  title: string;
  description: string;
  metricLabel: string;
  teacherOnly?: boolean;
  noMetric?: boolean;
}) {
  const { t } = useTranslations();
  if (!config) {
    return <div className="text-center py-8 text-sm text-muted-foreground">{t('paidServices.noSettings')}</div>;
  }

  const c = config;
  // Save a number field only when it changed and is valid (empty = unlimited for limits only).
  const saveNumber = (cfg: ConfigRow, key: string, el: HTMLInputElement, nullable: boolean) => {
    const raw = el.value.trim();
    const current = (cfg as unknown as Record<string, number | null>)[key];
    if (raw === '') {
      if (nullable) { if (current !== null) updateConfig(cfg.section_key, { [key]: null }); return; }
      toast.error(t('paidServices.invalidNumber')); el.value = String(current ?? 0); return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { toast.error(t('paidServices.invalidNumber')); el.value = String(current ?? ''); return; }
    if (n === Number(current)) return;
    updateConfig(cfg.section_key, { [key]: n });
  };
  const hasMetric = !noMetric && c.usage_metric;

  return (
    <div className="space-y-3">
      {/* Status badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {c.student_locked && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">{t('paidServices.lockedStudents')}</Badge>}
        {c.teacher_locked && <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">{t('paidServices.lockedTeachers')}</Badge>}
        {!c.student_locked && !c.teacher_locked && <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">{t('paidServices.openBadge')}</Badge>}
        {teacherOnly && <Badge variant="outline" className="text-[9px] bg-teal-50 text-teal-700 border-teal-200">{t('paidServices.teachersOnly')}</Badge>}
      </div>

      {/* Lock toggles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`grid gap-2 ${teacherOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!teacherOnly && (
              <label className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${c.student_locked ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border'}`}>
                <input type="checkbox" checked={c.student_locked}
                  onChange={(e) => updateConfig(c.section_key, { student_locked: e.target.checked })}
                  className="h-4 w-4" />
                <div>
                  <span className="text-xs font-medium">{t('paidServices.lockStudents')}</span>
                  <p className="text-[10px] text-muted-foreground">{t('paidServices.lockStudentsDesc')}</p>
                </div>
              </label>
            )}
            <label className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${c.teacher_locked ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border'}`}>
              <input type="checkbox" checked={c.teacher_locked}
                onChange={(e) => updateConfig(c.section_key, { teacher_locked: e.target.checked })}
                className="h-4 w-4" />
              <div>
                <span className="text-xs font-medium">{t('paidServices.lockTeachers')}</span>
                <p className="text-[10px] text-muted-foreground">{t('paidServices.lockTeachersDesc')}</p>
              </div>
            </label>
          </div>

          {/* Pricing */}
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('paidServices.prices', { currency: c.currency })}</p>
            <div className={`grid gap-3 ${teacherOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {!teacherOnly && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-sky-700 dark:text-sky-400">{t('paidServices.student')}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">{t('paidServices.monthly')}</Label>
                      <Input type="number" defaultValue={c.student_monthly_price}
                        onBlur={(e) => saveNumber(c, 'student_monthly_price', e.target, false)}
                        className="h-8 text-xs" placeholder="0" dir="ltr" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">{t('paidServices.yearly')}</Label>
                      <Input type="number" defaultValue={c.student_yearly_price}
                        onBlur={(e) => saveNumber(c, 'student_yearly_price', e.target, false)}
                        className="h-8 text-xs" placeholder="0" dir="ltr" />
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-teal-700 dark:text-teal-400">{t('paidServices.teacher')}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">{t('paidServices.monthly')}</Label>
                    <Input type="number" defaultValue={c.teacher_monthly_price}
                      onBlur={(e) => saveNumber(c, 'teacher_monthly_price', e.target, false)}
                      className="h-8 text-xs" placeholder="0" dir="ltr" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">{t('paidServices.yearly')}</Label>
                    <Input type="number" defaultValue={c.teacher_yearly_price}
                      onBlur={(e) => saveNumber(c, 'teacher_yearly_price', e.target, false)}
                      className="h-8 text-xs" placeholder="0" dir="ltr" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Usage limits */}
          {hasMetric && (
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">{t('paidServices.usageLimitTitle')}</p>
              <p className="text-[10px] text-muted-foreground mb-2">
                {t('paidServices.usageLimitDesc', { metric: metricLabel })}
              </p>
              <div className={`grid gap-3 ${teacherOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {!teacherOnly && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-sky-700 dark:text-sky-400">{t('paidServices.student')}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t('paidServices.monthlyLimit')}</Label>
                        <Input type="number" defaultValue={c.student_monthly_limit ?? ''}
                          onBlur={(e) => saveNumber(c, 'student_monthly_limit', e.target, true)}
                          className="h-8 text-xs" placeholder={t('paidServices.unlimited')} dir="ltr" />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t('paidServices.yearlyLimit')}</Label>
                        <Input type="number" defaultValue={c.student_yearly_limit ?? ''}
                          onBlur={(e) => saveNumber(c, 'student_yearly_limit', e.target, true)}
                          className="h-8 text-xs" placeholder={t('paidServices.unlimited')} dir="ltr" />
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-teal-700 dark:text-teal-400">{t('paidServices.teacher')}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">{t('paidServices.monthlyLimit')}</Label>
                      <Input type="number" defaultValue={c.teacher_monthly_limit ?? ''}
                        onBlur={(e) => saveNumber(c, 'teacher_monthly_limit', e.target, true)}
                        className="h-8 text-xs" placeholder={t('paidServices.unlimited')} dir="ltr" />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">{t('paidServices.yearlyLimit')}</Label>
                      <Input type="number" defaultValue={c.teacher_yearly_limit ?? ''}
                        onBlur={(e) => saveNumber(c, 'teacher_yearly_limit', e.target, true)}
                        className="h-8 text-xs" placeholder={t('paidServices.unlimited')} dir="ltr" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
