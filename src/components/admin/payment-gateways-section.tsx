'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, Plus, Wallet, Check, X, Clock, Shield, Settings, Zap,
  Globe, Edit, Power, Star, AlertCircle, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';

// ─── Types ───
interface GatewayMetadata {
  id: string;
  provider: string;
  displayName: string;
  environment: 'sandbox' | 'live';
  isEnabled: boolean;
  isDefault: boolean;
  capabilities: {
    supportsRefund: boolean;
    supportsVerify: boolean;
    supportsWebhook: boolean;
    supportsTestConnection: boolean;
    supportsRedirectCheckout: boolean;
    supportsEmbeddedCheckout: boolean;
  };
}

interface ProviderSchema {
  provider: string;
  displayName: string;
  credentialFields: Array<{
    name: string;
    label: string;
    type: 'text' | 'password' | 'number' | 'array';
    required: boolean;
    placeholder?: string;
    helpText?: string;
  }>;
  configurationFields: Array<{
    name: string;
    label: string;
    type: 'text' | 'password' | 'number' | 'array';
    required: boolean;
    placeholder?: string;
    helpText?: string;
  }>;
  isImplemented: boolean;
}

interface GatewayDetail {
  id: string;
  provider: string;
  displayName: string;
  environment: 'sandbox' | 'live';
  isEnabled: boolean;
  isDefault: boolean;
  capabilities: GatewayMetadata['capabilities'];
  configuration: Record<string, unknown>;
}

export default function PaymentGatewaysSection() {
  const [gateways, setGateways] = useState<GatewayMetadata[]>([]);
  const [providers, setProviders] = useState<ProviderSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingGateway, setEditingGateway] = useState<GatewayDetail | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getCachedAuthHeaders();
      const [gwRes, provRes] = await Promise.all([
        fetch('/api/admin/payment-gateways', { headers }),
        fetch('/api/admin/payment-gateways/providers', { headers }),
      ]);
      const gwJson = await gwRes.json();
      const provJson = await provRes.json();
      if (gwJson.success) setGateways(gwJson.gateways ?? []);
      if (provJson.success) setProviders(provJson.providers ?? []);
    } catch {
      toast.error('تعذّر تحميل بوابات الدفع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleEnable = async (id: string) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/payment-gateways/${id}/enable`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) { toast.success('تم تفعيل البوابة'); await load(); }
      else toast.error(json.error || 'فشل التفعيل');
    } catch { toast.error('تعذّر الاتصال'); }
    finally { setActioningId(null); }
  };

  const handleDisable = async (id: string) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/payment-gateways/${id}/disable`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) { toast.success('تم تعطيل البوابة'); await load(); }
      else toast.error(json.error || 'فشل التعطيل');
    } catch { toast.error('تعذّر الاتصال'); }
    finally { setActioningId(null); }
  };

  const handleSetDefault = async (id: string) => {
    setActioningId(id);
    try {
      const res = await fetch(`/api/admin/payment-gateways/${id}/set-default`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) { toast.success('تم تعيين البوابة كافتراضية'); await load(); }
      else toast.error(json.error || 'فشل التعيين');
    } catch { toast.error('تعذّر الاتصال'); }
    finally { setActioningId(null); }
  };

  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/admin/payment-gateways/${id}/test-connection`, { method: 'POST', headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) toast.success(json.message || 'الاتصال ناجح');
      else toast.error(json.error || json.message || 'فشل الاتصال');
    } catch { toast.error('تعذّر الاتصال'); }
    finally { setTestingId(null); }
  };

  const handleEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/payment-gateways/${id}`, { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) {
        setEditingGateway(json.gateway);
        setShowEditDialog(true);
      } else toast.error(json.error || 'تعذّر تحميل البيانات');
    } catch { toast.error('تعذّر الاتصال'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-sky-600" />
          <h2 className="text-lg font-bold">بوابات الدفع</h2>
        </div>
        <Button onClick={() => setShowAddDialog(true)} size="sm" className="bg-sky-600 hover:bg-sky-700">
          <Plus className="h-4 w-4 me-1" /> إضافة بوابة
        </Button>
      </div>

      {/* Gateways list */}
      {gateways.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>لا توجد بوابات دفع مُعدّة.</p>
            <p className="text-xs mt-1">اضغط "إضافة بوابة" لإنشاء بوابة دفع جديدة.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {gateways.map((gw, idx) => (
            <GatewayCard
              key={idx}
              gateway={gw}
              onEnable={handleEnable}
              onDisable={handleDisable}
              onSetDefault={handleSetDefault}
              onTestConnection={handleTestConnection}
              onEdit={handleEdit}
              testingId={testingId}
              actioningId={actioningId}
            />
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <AddGatewayDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        providers={providers}
        onCreated={() => { setShowAddDialog(false); load(); }}
      />

      {/* Edit Dialog */}
      <EditGatewayDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        gateway={editingGateway}
        providers={providers}
        onUpdated={() => { setShowEditDialog(false); setEditingGateway(null); load(); }}
      />
    </div>
  );
}

// ─── Gateway Card ───
function GatewayCard({
  gateway, onEnable, onDisable, onSetDefault, onTestConnection, onEdit, testingId, actioningId,
}: {
  gateway: GatewayMetadata;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
  onSetDefault: (id: string) => void;
  onTestConnection: (id: string) => void;
  onEdit: (id: string) => void;
  testingId: string | null;
  actioningId: string | null;
}) {
  // Use the gateway's DB UUID for all API calls
  const key = gateway.id;

  return (
    <Card className={`overflow-hidden ${gateway.isDefault ? 'ring-2 ring-sky-400' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              {gateway.displayName}
              {gateway.isDefault && (
                <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-200 text-[10px]">
                  <Star className="h-2.5 w-2.5 me-1" /> افتراضية
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {gateway.provider} · {gateway.environment === 'sandbox' ? 'تجريبي' : 'إنتاجي'}
            </CardDescription>
          </div>
          <Badge variant={gateway.isEnabled ? 'default' : 'secondary'} className="text-[10px]">
            {gateway.isEnabled ? 'مفعّلة' : 'معطّلة'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Capabilities */}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {gateway.capabilities.supportsWebhook && <Badge variant="outline" className="text-[9px]">Webhook</Badge>}
          {gateway.capabilities.supportsRedirectCheckout && <Badge variant="outline" className="text-[9px]">Redirect</Badge>}
          {gateway.capabilities.supportsVerify && <Badge variant="outline" className="text-[9px]">Verify</Badge>}
          {gateway.capabilities.supportsRefund && <Badge variant="outline" className="text-[9px]">Refund</Badge>}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onEdit(key)} className="h-7 text-xs">
            <Edit className="h-3 w-3 me-1" /> تعديل
          </Button>
          {gateway.isEnabled ? (
            <Button size="sm" variant="ghost" onClick={() => onDisable(key)} disabled={actioningId === key || gateway.isDefault} className="h-7 text-xs text-amber-600 hover:bg-amber-50">
              <Power className="h-3 w-3 me-1" /> تعطيل
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onEnable(key)} disabled={actioningId === key} className="h-7 text-xs text-emerald-600 hover:bg-emerald-50">
              <Power className="h-3 w-3 me-1" /> تفعيل
            </Button>
          )}
          {!gateway.isDefault && gateway.isEnabled && (
            <Button size="sm" variant="ghost" onClick={() => onSetDefault(key)} disabled={actioningId === key} className="h-7 text-xs text-sky-600 hover:bg-sky-50">
              <Star className="h-3 w-3 me-1" /> افتراضية
            </Button>
          )}
          {gateway.capabilities.supportsTestConnection && (
            <Button size="sm" variant="ghost" onClick={() => onTestConnection(key)} disabled={testingId === key} className="h-7 text-xs">
              {testingId === key ? <Loader2 className="h-3 w-3 me-1 animate-spin" /> : <Zap className="h-3 w-3 me-1" />}
              اختبار
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Add Gateway Dialog ───
function AddGatewayDialog({
  open, onOpenChange, providers, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderSchema[];
  onCreated: () => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'live'>('sandbox');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [configuration, setConfiguration] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const selectedSchema = providers.find(p => p.provider === selectedProvider);

  const handleSubmit = async () => {
    if (!selectedProvider || !displayName) {
      toast.error('الرجاء اختيار المزود وإدخال الاسم');
      return;
    }
    setSubmitting(true);
    try {
      // Convert comma-separated arrays
      const processedCreds: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(credentials)) {
        if (selectedSchema?.credentialFields.find(f => f.name === k)?.type === 'array') {
          processedCreds[k] = v.split(',').map(s => s.trim()).filter(Boolean).map(Number.isNaN ? String : Number);
        } else {
          processedCreds[k] = v;
        }
      }
      const processedConfig: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(configuration)) {
        if (selectedSchema?.configurationFields.find(f => f.name === k)?.type === 'array') {
          processedConfig[k] = v.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          processedConfig[k] = v;
        }
      }

      const res = await fetch('/api/admin/payment-gateways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          provider: selectedProvider,
          displayName,
          environment,
          credentials: processedCreds,
          configuration: processedConfig,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إنشاء البوابة بنجاح');
        setSelectedProvider(''); setDisplayName(''); setCredentials({}); setConfiguration({});
        onCreated();
      } else toast.error(json.error || 'فشل الإنشاء');
    } catch { toast.error('تعذّر الاتصال'); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-sky-600" /> إضافة بوابة دفع</DialogTitle>
          <DialogDescription>أدخل بيانات البوابة الجديدة. تُشفَّر البيانات الحساسة تلقائياً.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Provider selection */}
          <div className="space-y-2">
            <Label>المزود</Label>
            <div className="grid grid-cols-2 gap-2">
              {providers.map(p => (
                <button
                  key={p.provider}
                  type="button"
                  onClick={() => { setSelectedProvider(p.provider); setDisplayName(p.displayName); setCredentials({}); setConfiguration({}); }}
                  className={`rounded-lg border p-2 text-sm transition-colors ${selectedProvider === p.provider ? 'border-sky-400 bg-sky-50' : 'border-gray-200 hover:bg-gray-50'}`}
                >
                  {p.displayName}
                </button>
              ))}
            </div>
          </div>

          {selectedSchema && (
            <>
              <div className="space-y-2">
                <Label>الاسم المعروض</Label>
                <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="مثال: Paymob Sandbox" />
              </div>

              <div className="space-y-2">
                <Label>البيئة</Label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEnvironment('sandbox')} className={`rounded-lg border px-3 py-1.5 text-sm ${environment === 'sandbox' ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200'}`}>تجريبي</button>
                  <button type="button" onClick={() => setEnvironment('live')} className={`rounded-lg border px-3 py-1.5 text-sm ${environment === 'live' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200'}`}>إنتاجي</button>
                </div>
              </div>

              {/* Credentials fields */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">بيانات الدخول (Credentials)</Label>
                {selectedSchema.credentialFields.map(field => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-xs">{field.label} {field.required && <span className="text-rose-500">*</span>}</Label>
                    <Input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={credentials[field.name] || ''}
                      onChange={e => setCredentials(prev => ({ ...prev, [field.name]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="h-9 text-sm"
                      dir="ltr"
                    />
                    {field.helpText && <p className="text-[10px] text-muted-foreground">{field.helpText}</p>}
                  </div>
                ))}
              </div>

              {/* Configuration fields */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">الإعدادات (Configuration)</Label>
                {selectedSchema.configurationFields.map(field => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-xs">{field.label} {field.required && <span className="text-rose-500">*</span>}</Label>
                    <Input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={configuration[field.name] || ''}
                      onChange={e => setConfiguration(prev => ({ ...prev, [field.name]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="h-9 text-sm"
                      dir="ltr"
                    />
                    {field.helpText && <p className="text-[10px] text-muted-foreground">{field.helpText}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={submitting || !selectedProvider || !displayName} className="bg-sky-600 hover:bg-sky-700">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Plus className="h-4 w-4 me-1" />}
            إنشاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Gateway Dialog ───
function EditGatewayDialog({
  open, onOpenChange, gateway, providers, onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateway: GatewayDetail | null;
  providers: ProviderSchema[];
  onUpdated: () => void;
}) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [configuration, setConfiguration] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (gateway) {
      // Pre-fill configuration from the gateway (non-secret)
      setConfiguration(
        Object.fromEntries(
          Object.entries(gateway.configuration).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
        )
      );
      // Credentials are EMPTY (don't show existing — just allow new entry)
      setCredentials({});
    }
  }, [gateway]);

  if (!gateway) return null;

  const schema = providers.find(p => p.provider === gateway.provider);

  const handleSubmit = async () => {
    if (!gateway) return;
    setSubmitting(true);
    try {
      // Only send credentials if at least one field is filled
      const hasCreds = Object.values(credentials).some(v => v.trim());
      const processedCreds: Record<string, unknown> = {};
      if (hasCreds) {
        for (const [k, v] of Object.entries(credentials)) {
          if (!v.trim()) continue;
          if (schema?.credentialFields.find(f => f.name === k)?.type === 'array') {
            processedCreds[k] = v.split(',').map(s => s.trim()).filter(Boolean).map(Number.isNaN ? String : Number);
          } else {
            processedCreds[k] = v;
          }
        }
      }
      const processedConfig: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(configuration)) {
        if (schema?.configurationFields.find(f => f.name === k)?.type === 'array') {
          processedConfig[k] = v.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          processedConfig[k] = v;
        }
      }

      const res = await fetch(`/api/admin/payment-gateways/${gateway.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          credentials: hasCreds ? processedCreds : undefined,
          configuration: processedConfig,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحديث البوابة');
        onUpdated();
      } else toast.error(json.error || 'فشل التحديث');
    } catch { toast.error('تعذّر الاتصال'); }
    finally { setSubmitting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Edit className="h-5 w-5 text-sky-600" /> تعديل بوابة: {gateway.displayName}</DialogTitle>
          <DialogDescription>
            المزود: {gateway.provider} · البيئة: {gateway.environment === 'sandbox' ? 'تجريبي' : 'إنتاجي'}
          </DialogDescription>
        </DialogHeader>

        {schema && (
          <div className="space-y-4">
            {/* Credentials — empty (leave empty to keep existing) */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-slate-500" />
                <Label className="text-sm font-semibold">بيانات الدخول (اتركها فارغة للإبقاء على الحالي)</Label>
              </div>
              {schema.credentialFields.map(field => (
                <div key={field.name} className="space-y-1">
                  <Label className="text-xs">{field.label}</Label>
                  <Input
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={credentials[field.name] || ''}
                    onChange={e => setCredentials(prev => ({ ...prev, [field.name]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="h-9 text-sm"
                    dir="ltr"
                  />
                </div>
              ))}
            </div>

            {/* Configuration — pre-filled */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">الإعدادات</Label>
              {schema.configurationFields.map(field => (
                <div key={field.name} className="space-y-1">
                  <Label className="text-xs">{field.label}</Label>
                  <Input
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={configuration[field.name] || ''}
                    onChange={e => setConfiguration(prev => ({ ...prev, [field.name]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="h-9 text-sm"
                    dir="ltr"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="bg-sky-600 hover:bg-sky-700">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Check className="h-4 w-4 me-1" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
