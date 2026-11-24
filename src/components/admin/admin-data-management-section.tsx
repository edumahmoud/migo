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
import MascotLoader from '@/components/shared/mascot-loader';

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

export default function AdminDataManagementSection() {
  const { t, direction } = useTranslations();
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
        toast.error(json.error || t('dataManagement.previewFailed'));
      }
    } catch {
      toast.error(t('dataManagement.unexpected'));
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
      toast.error(t('dataManagement.selectAtLeastOne'));
      return;
    }

    const ok = await confirm({
      title: t('dataManagement.deleteConfirmTitle'),
      description: `${t('dataManagement.deleteConfirmDesc', { count: selectedCategories.size })} ${deleteSelf ? t('dataManagement.alsoDeleteAccount') : t('dataManagement.keepAccount')} ${t('dataManagement.noUndo')}`,
      confirmLabel: t('dataManagement.proceed'),
      cancelLabel: t('common.cancel'),
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
        toast.success(t('dataManagement.deleteSuccess', { count: json.summary.totalDeleted }));
        // If deleteSelf, the account is being destroyed — sign out.
        if (deleteSelf) {
          setTimeout(() => window.location.href = '/', 3000);
        } else {
          // Refresh preview.
          fetchPreview();
        }
      } else {
        toast.error(json.error || t('dataManagement.executeFailed'));
      }
    } catch {
      toast.error(t('dataManagement.unexpected'));
    } finally {
      setExecuting(false);
    }
  };

  const [executePassword, setExecutePassword] = useState('');

  // ─── Loading state ───
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <MascotLoader kind="ai" size={96} />
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
            {t('dataManagement.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('dataManagement.subtitle1')}{' '}
            {t('dataManagement.subtitle2')}
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
              {t('dataManagement.verifiedNote')}
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => { setToken(null); setPhase('locked'); }}>
              <Lock className="h-4 w-4 me-1" />
              {t('dataManagement.lock')}
            </Button>
          </div>

          {/* Preview */}
          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <MascotLoader kind="ai" size={72} />
            </div>
          ) : preview ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4 text-sky-600" />
                  {t('dataManagement.sectionTitle')}
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
                          <span className="font-medium text-sm">{t(`dataManagement.cat.${key}`)}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {t('dataManagement.rowsCount', { count: cat.total })}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {t(`dataManagement.catDesc.${key}`)}
                        </p>
                        <details className="mt-1">
                          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                            {t('dataManagement.showTables', { count: cat.tables.length })}
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
                          {t('dataManagement.deleteMyAccount')}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {t('dataManagement.deleteMyAccountDesc')}
                      </p>
                    </div>
                  </label>
                </div>

                {/* Execute section */}
                <div className="border-t pt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">{t('dataManagement.reenterLabel')}</Label>
                    <Input
                      type="password"
                      value={executePassword}
                      onChange={(e) => setExecutePassword(e.target.value)}
                      placeholder={t('dataManagement.passwordPlaceholder')}
                      dir="ltr"
                    />
                  </div>

                  {selectedCategories.size > 0 && (
                    <div className="rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-xs">
                      <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-medium mb-1">
                        <AlertTriangle className="h-4 w-4" />
                        {t('dataManagement.willDelete', { count: selectedCategories.size })}
                      </div>
                      <p className="text-muted-foreground">
                        {t('dataManagement.typeDeleteHintPre')} <span className="font-mono font-bold text-rose-600">DELETE</span> {t('dataManagement.typeDeleteHintPost')}
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handleExecute}
                    disabled={executing || selectedCategories.size === 0 || !executePassword}
                    className="w-full bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    {executing ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Trash2 className="h-4 w-4 me-1" />}
                    {t('dataManagement.executeDelete')}
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
      toast.error(t('dataManagement.passwordMismatch'));
      return;
    }
    if (password.length < 8) {
      toast.error(t('dataManagement.passwordTooShort'));
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
        toast.success(t('dataManagement.passwordSetSuccess'));
        onSuccess();
      } else {
        toast.error(json.error || t('dataManagement.failed'));
      }
    } catch {
      toast.error(t('dataManagement.unexpected'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-600" />
          {t('dataManagement.setPasswordTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>{t('dataManagement.newPasswordLabel')}</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label>{t('dataManagement.confirmPasswordLabel')}</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('dataManagement.passwordNote1')}{' '}
          {t('dataManagement.passwordNote2')}
        </p>
        <Button onClick={handleSubmit} disabled={saving || !password || !confirm} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : null}
          {t('dataManagement.setPasswordButton')}
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
        toast.success(t('dataManagement.verified'));
        onSuccess(json.token);
      } else {
        toast.error(json.error || t('dataManagement.verifyFailed'));
      }
    } catch {
      toast.error(t('dataManagement.unexpected'));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="h-4 w-4 text-amber-600" />
          {t('dataManagement.enterPasswordTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>{t('dataManagement.passwordLabel')}</Label>
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
          {t('dataManagement.unlockButton')}
        </Button>
      </CardContent>
    </Card>
  );
}
