'use client';

/**
 * AdminDataManagementSection — v133
 *
 * The most dangerous section in the admin portal. Allows the superadmin
 * to wipe platform data by category (users, academic, financial,
 * communication, settings, analytics) with an option to delete their
 * own account.
 *
 * Security layers (defense in depth):
 *   1. Superadmin auth (enforced at the API level).
 *   2. Separate "destruct password" — must be set first, then verified
 *      to get a short-lived token (10 min).
 *   3. The token gates access to the preview + execute endpoints.
 *   4. Before execution, the password must be re-entered.
 *   5. The user must type "DELETE" as a final confirmation.
 *
 * The UI has 3 states:
 *   - 'setPassword': no destruct password exists yet → show setup form.
 *   - 'locked': destruct password exists → show unlock form.
 *   - 'unlocked': token obtained → show the category checkboxes +
 *     preview + execute form.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldAlert, Lock, Trash2, AlertTriangle, Eye, Database, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useTranslations } from '@/i18n/use-translations';

type Phase = 'loading' | 'setPassword' | 'locked' | 'unlocked';

interface CategoryData {
  label: string;
  tables: Array<{ name: string; count: number }>;
  total: number;
}
interface PreviewData {
  categories: Record<string, CategoryData>;
  grandTotal: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  users: 'الحسابات المسجلة',
  academic: 'البيانات الأكاديمية',
  financial: 'البيانات المالية',
  communication: 'البيانات التواصلية',
  settings: 'إعدادات المنصة',
  analytics: 'بيانات التحليلات',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  users: 'كل المستخدمين (الطلاب، المعلمين، الوكلاء) + بياناتهم المرتبطة',
  academic: 'المقررات، المحاضرات، الدروس، الاختبارات، الواجبات، الحضور، SCORM',
  financial: 'الطلبات، المدفوعات، السجل المالي، العمولات، طرق الدفع',
  communication: 'الإشعارات، الإعلانات، الرسائل، الاستطلاعات، البلاغات',
  settings: 'إعدادات المؤسسة (الاسم، الشعار، إلخ)',
  analytics: 'البيانات التحليلية المُخزّنة مؤقتاً',
};

export default function AdminDataManagementSection() {
  const { direction } = useTranslations();
  const [phase, setPhase] = useState<Phase>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [deleteSelf, setDeleteSelf] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const { confirmDialog, confirm } = useConfirmDialog();

  // ─── On mount: check if destruct password is set ───
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/destruct/set-password', {
          headers: await getCachedAuthHeaders(),
        });
        const json = await res.json();
        if (json.hasPassword) {
          setPhase('locked');
        } else {
          setPhase('setPassword');
        }
      } catch {
        setPhase('setPassword');
      }
    })();
  }, []);

  // ─── Fetch preview when unlocked ───
  const fetchPreview = useCallback(async () => {
    if (!token) return;
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/admin/destruct/preview', {
        headers: {
          ...await getCachedAuthHeaders(),
          'x-destruct-token': token,
        },
      });
      const json = await res.json();
      if (json.success) {
        setPreview(json);
      } else {
        toast.error(json.error || 'فشل جلب المعاينة');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setPreviewLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (phase === 'unlocked' && token) {
      fetchPreview();
    }
  }, [phase, token, fetchPreview]);

  // ─── Toggle a category ───
  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // ─── Execute the destruction ───
  const handleExecute = async () => {
    if (selectedCategories.size === 0) {
      toast.error('اختر فئة واحدة على الأقل');
      return;
    }

    const ok = await confirm({
      title: 'تأكيد الحذف النهائي',
      description: `سيتم حذف ${selectedCategories.size} فئة من البيانات نهائياً. ${deleteSelf ? 'سيتم أيضاً حذف حسابك.' : 'لن يتم حذف حسابك.'} لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: 'متابعة',
      cancelLabel: 'إلغاء',
      variant: 'destructive',
    });
    if (!ok) return;

    setExecuting(true);
    try {
      const res = await fetch('/api/admin/destruct/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders(), 'x-destruct-token': token || '' },
        body: JSON.stringify({
          password: executePassword,
          token,
          confirmation: 'DELETE',
          categories: Array.from(selectedCategories),
          deleteSelf,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم حذف ${json.summary.totalDeleted} صف نهائياً`);
        // If deleteSelf, the account is being destroyed — sign out.
        if (deleteSelf) {
          setTimeout(() => window.location.href = '/', 3000);
        } else {
          // Refresh preview.
          fetchPreview();
        }
      } else {
        toast.error(json.error || 'فشل التنفيذ');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setExecuting(false);
    }
  };

  const [executePassword, setExecutePassword] = useState('');

  // ─── Loading state ───
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4" dir={direction}>
      {confirmDialog}

      {/* ─── Header ─── */}
      <Card className="border-rose-200 dark:border-rose-900/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
            <ShieldAlert className="h-5 w-5" />
            إدارة بيانات المنصة — منطقة الخطر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            هذا القسم يسمح بحذف بيانات المنصة بالكامل. يتطلب كلمة مرور منفصلة عن كلمة مرور حسابك.
            جميع العمليات هنا لا يمكن التراجع عنها.
          </p>
        </CardContent>
      </Card>

      {/* ─── Phase: Set Password ─── */}
      {phase === 'setPassword' && (
        <SetPasswordForm onSuccess={() => setPhase('locked')} />
      )}

      {/* ─── Phase: Locked ─── */}
      {phase === 'locked' && (
        <UnlockForm onSuccess={(newToken) => { setToken(newToken); setPhase('unlocked'); }} />
      )}

      {/* ─── Phase: Unlocked ─── */}
      {phase === 'unlocked' && (
        <>
          {/* Token info + re-lock button */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3 w-3 me-1" />
              تم التحقق — الجلسة تنتهي خلال 10 دقائق
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => { setToken(null); setPhase('locked'); }}>
              <Lock className="h-4 w-4 me-1" />
              قفل
            </Button>
          </div>

          {/* Preview */}
          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
            </div>
          ) : preview ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4 text-sky-600" />
                  بيانات المنصة — اختر ما تريد حذفه
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(preview.categories).map(([key, cat]) => (
                  <div key={key} className={`rounded-lg border p-3 transition-colors ${selectedCategories.has(key) ? 'border-rose-300 bg-rose-50/50 dark:bg-rose-900/10' : 'border-border'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={selectedCategories.has(key)}
                        onCheckedChange={() => toggleCategory(key)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{cat.label}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {cat.total} صف
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {CATEGORY_DESCRIPTIONS[key]}
                        </p>
                        <details className="mt-1">
                          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                            عرض الجداول ({cat.tables.length})
                          </summary>
                          <div className="mt-1 text-[10px] text-muted-foreground space-y-0.5">
                            {cat.tables.map(t => (
                              <div key={t.name} className="flex justify-between">
                                <span className="font-mono">{t.name}</span>
                                <span>{t.count}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    </label>
                  </div>
                ))}

                {/* Delete self option */}
                <div className={`rounded-lg border p-3 transition-colors ${deleteSelf ? 'border-rose-400 bg-rose-50 dark:bg-rose-900/20' : 'border-rose-200'}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={deleteSelf}
                      onCheckedChange={(c) => setDeleteSelf(c === true)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-rose-700 dark:text-rose-400">
                          حذف حسابي أيضاً
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        سيتم حذف حساب الأدمن الخاص بك نهائياً بعد حذف باقي البيانات. سيتم تسجيل خروجك تلقائياً.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Execute section */}
                <div className="border-t pt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">أعد إدخال كلمة مرور الحذف للتأكيد</Label>
                    <Input
                      type="password"
                      value={executePassword}
                      onChange={(e) => setExecutePassword(e.target.value)}
                      placeholder="كلمة مرور الحذف"
                      dir="ltr"
                    />
                  </div>

                  {selectedCategories.size > 0 && (
                    <div className="rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-xs">
                      <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-medium mb-1">
                        <AlertTriangle className="h-4 w-4" />
                        سيتم حذف {selectedCategories.size} فئة
                      </div>
                      <p className="text-muted-foreground">
                        لإتمام العملية، اكتب كلمة <span className="font-mono font-bold text-rose-600">DELETE</span> في رسالة التأكيد التي ستظهر.
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handleExecute}
                    disabled={executing || selectedCategories.size === 0 || !executePassword}
                    className="w-full bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    {executing ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Trash2 className="h-4 w-4 me-1" />}
                    تنفيذ الحذف النهائي
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Set Password Form ───
function SetPasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (password !== confirm) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }
    if (password.length < 8) {
      toast.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/destruct/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تعيين كلمة مرور الحذف');
        onSuccess();
      } else {
        toast.error(json.error || 'فشل');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-600" />
          تعيين كلمة مرور الحذف (لأول مرة)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>كلمة المرور الجديدة</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label>تأكيد كلمة المرور</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          كلمة المرور هذه منفصلة عن كلمة مرور حسابك. ستُطلب عند كل دخول لهذا القسم وعند تنفيذ أي حذف.
          يجب أن تحتوي على 8 أحرف على الأقل مع أحرف وأرقام.
        </p>
        <Button onClick={handleSubmit} disabled={saving || !password || !confirm} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : null}
          تعيين كلمة المرور
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Unlock Form ───
function UnlockForm({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleUnlock = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/admin/destruct/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getCachedAuthHeaders() },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم التحقق');
        onSuccess(json.token);
      } else {
        toast.error(json.error || 'فشل التحقق');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-600" />
          إدخال كلمة مرور الحذف
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>كلمة مرور الحذف</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && password) handleUnlock(); }}
            placeholder="••••••••"
            dir="ltr"
            autoFocus
          />
        </div>
        <Button onClick={handleUnlock} disabled={verifying || !password} className="w-full">
          {verifying ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Lock className="h-4 w-4 me-1" />}
          فتح القسم
        </Button>
      </CardContent>
    </Card>
  );
}
