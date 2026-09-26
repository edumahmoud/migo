'use client';

// =====================================================
// TeacherPayoutMethodsSection — Phase 11
// =====================================================
// Allows the authenticated teacher to manage their own
// payout methods (mobile wallets only — Vodafone/Etisalat/
// Orange/WE Cash).
//
// Critical security properties:
//   - teacher_id is NEVER sent from the client; the API
//     derives it from the session.
//   - The frontend NEVER sees the full wallet number — only
//     the masked summary (last 4 digits).
//   - The component offers NO way to:
//       * access another teacher's methods
//       * change teacher_id
//       * change method_type after creation
//       * hard-delete a method (only soft-disable)
//       * self-verify (admin-only)
//
// UI states:
//   - Loading (skeleton / spinner)
//   - Empty state (no methods yet)
//   - List state (cards with masked info + actions)
//   - Create/Edit form (modal or inline)
//   - Error state (with retry)
//
// Mobile responsive:
//   - Cards stack to 1 column below md
//   - Form is single-column on all viewports
// =====================================================

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  Star,
  CheckCircle2,
  Pencil,
  Power,
  PowerOff,
  X,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

// ─── Types ───
interface PayoutMethod {
  id: string;
  method_type: string;
  display_label: string;
  details_masked: string;
  is_active: boolean;
  is_default: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderSchema {
  method_type: string;
  display_name: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    pattern?: string;
    helpText?: string;
    maxLength?: number;
  }>;
}

// ─── Method type → i18n key + icon map ───
// All 4 supported types. Adding a new type requires updating this map
// AND the schema + DB CHECK constraint.
const METHOD_TYPE_LABEL_KEY: Record<string, string> = {
  vodafone_cash: 'payoutMethods.providers.vodafoneCash',
  etisalat_cash: 'payoutMethods.providers.etisalatCash',
  orange_cash: 'payoutMethods.providers.orangeCash',
  we_cash: 'payoutMethods.providers.weCash',
};

// ─── Component ───
export default function TeacherPayoutMethodsSection() {
  const { t, direction } = useTranslations();
  const isRTL = direction === 'rtl';

  // Data state
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [providers, setProviders] = useState<ProviderSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PayoutMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [form, setForm] = useState({
    method_type: '',
    display_label: '',
    wallet_number: '',
    holder_name: '',
    set_as_default: false,
  });

  // ─── Fetch data ───
  const fetchMethods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/teacher/payout-methods${includeInactive ? '?include_inactive=true' : ''}`;
      const res = await fetch(url, { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t('payoutMethods.errors.loadFailed'));
      setMethods(json.methods ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('payoutMethods.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [includeInactive, t]);

  const fetchProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const res = await fetch('/api/teacher/payout-methods/providers', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) setProviders(json.providers ?? []);
    } catch {
      // Providers list is non-critical — we still have method_type labels
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchMethods();
  }, [fetchMethods]);

  // ─── Actions ───

  const resetForm = () => {
    setForm({
      method_type: '',
      display_label: '',
      wallet_number: '',
      holder_name: '',
      set_as_default: false,
    });
  };

  const openCreate = () => {
    resetForm();
    setEditingMethod(null);
    setShowCreate(true);
  };

  const openEdit = (method: PayoutMethod) => {
    setForm({
      method_type: method.method_type,
      display_label: method.display_label,
      wallet_number: '', // never pre-fill sensitive fields
      holder_name: '',
      set_as_default: method.is_default,
    });
    setEditingMethod(method);
    setShowCreate(true);
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/teacher/payout-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('payoutMethods.errors.createFailed'));
        return;
      }
      toast.success(t('payoutMethods.toast.created'));
      setShowCreate(false);
      resetForm();
      await fetchMethods();
    } catch {
      toast.error(t('payoutMethods.errors.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingMethod) return;
    setSubmitting(true);
    try {
      // Build patch body — only include fields the user filled in.
      const patch: Record<string, unknown> = {
        display_label: form.display_label,
      };
      if (form.wallet_number.trim()) patch.wallet_number = form.wallet_number.trim();
      if (form.holder_name.trim()) patch.holder_name = form.holder_name.trim();

      const res = await fetch(`/api/teacher/payout-methods/${editingMethod.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('payoutMethods.errors.updateFailed'));
        return;
      }
      toast.success(t('payoutMethods.toast.updated'));
      setShowCreate(false);
      resetForm();
      setEditingMethod(null);
      await fetchMethods();
    } catch {
      toast.error(t('payoutMethods.errors.updateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async (id: string) => {
    if (!confirm(t('payoutMethods.confirm.disable'))) return;
    try {
      const res = await fetch(`/api/teacher/payout-methods/${id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('payoutMethods.errors.disableFailed'));
        return;
      }
      toast.success(t('payoutMethods.toast.disabled'));
      await fetchMethods();
    } catch {
      toast.error(t('payoutMethods.errors.disableFailed'));
    }
  };

  const handleReenable = async (id: string) => {
    try {
      const res = await fetch(`/api/teacher/payout-methods/${id}/reenable`, {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('payoutMethods.errors.reenableFailed'));
        return;
      }
      toast.success(t('payoutMethods.toast.reenabled'));
      await fetchMethods();
    } catch {
      toast.error(t('payoutMethods.errors.reenableFailed'));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/teacher/payout-methods/${id}/set-default`, {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || t('payoutMethods.errors.setDefaultFailed'));
        return;
      }
      toast.success(t('payoutMethods.toast.defaultSet'));
      await fetchMethods();
    } catch {
      toast.error(t('payoutMethods.errors.setDefaultFailed'));
    }
  };

  // ─── Helpers ───
  const getMethodTypeLabel = (type: string): string => {
    return t(METHOD_TYPE_LABEL_KEY[type] || `payoutMethods.providers.${type}`);
  };

  const formatDate = (iso: string | null): string => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  // Selected schema (for create form field rendering)
  const selectedSchema = providers.find((p) => p.method_type === form.method_type);

  // ─── Render ───

  if (loading && methods.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3" dir={direction}>
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
        <p className="text-sm text-muted-foreground">{t('payoutMethods.loading')}</p>
      </div>
    );
  }

  if (error && methods.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 gap-4 text-center"
        dir={direction}
      >
        <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-3">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <p className="font-semibold text-foreground">{t('payoutMethods.errors.loadFailed')}</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button onClick={fetchMethods} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 me-2" />
          {t('payoutMethods.errors.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={direction}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            {t('payoutMethods.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('payoutMethods.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIncludeInactive((v) => !v)}
          >
            {includeInactive
              ? t('payoutMethods.actions.hideInactive')
              : t('payoutMethods.actions.showInactive')}
          </Button>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 me-1" />
            {t('payoutMethods.actions.add')}
          </Button>
        </div>
      </div>

      {/* Methods list */}
      {methods.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="rounded-full bg-muted p-4">
              <Wallet className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('payoutMethods.empty')}
            </p>
            <Button onClick={openCreate} variant="outline" size="sm" className="mt-2">
              <Plus className="h-4 w-4 me-1" />
              {t('payoutMethods.actions.addFirst')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {methods.map((method) => (
            <motion.div
              key={method.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              layout
            >
              <Card className={!method.is_active ? 'opacity-60' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 p-2 shrink-0">
                        <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">
                          {method.display_label}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {getMethodTypeLabel(method.method_type)}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {method.is_default && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 gap-1">
                          <Star className="h-3 w-3" />
                          {t('payoutMethods.badges.default')}
                        </Badge>
                      )}
                      {method.verified_at && (
                        <Badge variant="secondary" className="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          {t('payoutMethods.badges.verified')}
                        </Badge>
                      )}
                      {!method.is_active && (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground">
                          {t('payoutMethods.badges.disabled')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Masked info — NEVER the full wallet number */}
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t('payoutMethods.fields.masked')}
                    </p>
                    <p className="font-mono text-sm tracking-wider">
                      {method.details_masked}
                    </p>
                  </div>

                  {/* Metadata */}
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p>{t('payoutMethods.fields.createdAt')}</p>
                      <p className="font-medium text-foreground">
                        {formatDate(method.created_at)}
                      </p>
                    </div>
                    <div>
                      <p>{t('payoutMethods.fields.verifiedAt')}</p>
                      <p className="font-medium text-foreground">
                        {formatDate(method.verified_at)}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
                    {method.is_active && !method.is_default && (
                      <Button
                        onClick={() => handleSetDefault(method.id)}
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                      >
                        <Star className="h-3.5 w-3.5 me-1" />
                        {t('payoutMethods.actions.setDefault')}
                      </Button>
                    )}
                    <Button
                      onClick={() => openEdit(method)}
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                    >
                      <Pencil className="h-3.5 w-3.5 me-1" />
                      {t('payoutMethods.actions.edit')}
                    </Button>
                    {method.is_active ? (
                      <Button
                        onClick={() => handleDisable(method.id)}
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-rose-600 hover:text-rose-700"
                      >
                        <PowerOff className="h-3.5 w-3.5 me-1" />
                        {t('payoutMethods.actions.disable')}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleReenable(method.id)}
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-emerald-600 hover:text-emerald-700"
                      >
                        <Power className="h-3.5 w-3.5 me-1" />
                        {t('payoutMethods.actions.reenable')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />
              {editingMethod
                ? t('payoutMethods.dialog.editTitle')
                : t('payoutMethods.dialog.createTitle')}
            </DialogTitle>
            <DialogDescription>
              {editingMethod
                ? t('payoutMethods.dialog.editDescription')
                : t('payoutMethods.dialog.createDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Method type — disabled when editing (immutable) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('payoutMethods.dialog.methodType')}
              </label>
              <Select
                value={form.method_type}
                onValueChange={(v) => setForm((f) => ({ ...f, method_type: v }))}
                disabled={!!editingMethod || providersLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('payoutMethods.dialog.selectType')} />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.method_type} value={p.method_type}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingMethod && (
                <p className="text-[10px] text-muted-foreground">
                  {t('payoutMethods.dialog.cannotChangeType')}
                </p>
              )}
            </div>

            {/* Display label */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('payoutMethods.dialog.displayLabel')}
              </label>
              <Input
                value={form.display_label}
                onChange={(e) => setForm((f) => ({ ...f, display_label: e.target.value }))}
                maxLength={100}
                placeholder={t('payoutMethods.dialog.displayLabelPlaceholder')}
              />
            </div>

            {/* Wallet number */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('payoutMethods.dialog.walletNumber')}
                {editingMethod && (
                  <span className="text-[10px] text-muted-foreground ms-1">
                    ({t('payoutMethods.dialog.leaveBlankToKeep')})
                  </span>
                )}
              </label>
              <Input
                type="tel"
                inputMode="numeric"
                value={form.wallet_number}
                onChange={(e) =>
                  setForm((f) => ({ ...f, wallet_number: e.target.value.replace(/\D/g, '') }))
                }
                maxLength={11}
                placeholder="01012345678"
                pattern="^01[0125][0-9]{8}$"
              />
              <p className="text-[10px] text-muted-foreground">
                {t('payoutMethods.dialog.walletHelpText')}
              </p>
            </div>

            {/* Holder name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('payoutMethods.dialog.holderName')}
                {editingMethod && (
                  <span className="text-[10px] text-muted-foreground ms-1">
                    ({t('payoutMethods.dialog.leaveBlankToKeep')})
                  </span>
                )}
              </label>
              <Input
                value={form.holder_name}
                onChange={(e) => setForm((f) => ({ ...f, holder_name: e.target.value }))}
                maxLength={100}
                placeholder={t('payoutMethods.dialog.holderNamePlaceholder')}
              />
            </div>

            {/* Set as default (only for create) */}
            {!editingMethod && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.set_as_default}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, set_as_default: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-sm">{t('payoutMethods.dialog.setAsDefault')}</span>
              </label>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                resetForm();
                setEditingMethod(null);
              }}
              disabled={submitting}
            >
              {t('payoutMethods.dialog.cancel')}
            </Button>
            <Button
              onClick={editingMethod ? handleUpdate : handleCreate}
              disabled={
                submitting ||
                !form.method_type ||
                !form.display_label ||
                (!editingMethod && (!form.wallet_number || !form.holder_name))
              }
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin me-1" />
              ) : (
                <CheckCircle2 className="h-4 w-4 me-1" />
              )}
              {editingMethod
                ? t('payoutMethods.dialog.saveChanges')
                : t('payoutMethods.dialog.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
