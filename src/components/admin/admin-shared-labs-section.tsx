'use client';

/**
 * Super-admin: shared lab devices. Register a lab by public IP / range and/or register each lab machine.
 * Devices from a lab count as shared, so they never raise "device belongs to someone else" alerts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pencil, MonitorSmartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface LabDevice { device_id: string; label: string | null; last_seen: string }
interface Lab { id: string; name: string; location: string | null; notes: string | null; ip_cidr: string | null; devices: LabDevice[] }
interface Current { deviceId: string; isShared: boolean; labId: string | null }

const TEXT = {
  ar: {
    title: 'الأجهزة المشتركة (المعامل)', desc: 'سجّل المعمل بالـ IP العام أو نطاق IP، و/أو سجّل كل جهاز في المعمل. أي جهاز من المعمل يُعتبر مشتركًا ولا تظهر عنه تنبيهات "جهاز يخص مستخدم آخر". لا يمكن قراءة MAC من المتصفح أو التطبيق، لذلك لا نستخدمه.',
    add: 'إضافة معمل', name: 'اسم المعمل', location: 'المكان', notes: 'ملاحظات', ip: 'IP عام أو نطاق (مثال 41.33.10.5 أو 41.33.10.0/24)', save: 'حفظ', cancel: 'إلغاء',
    edit: 'تعديل', remove: 'حذف', confirmDel: 'حذف هذا المعمل؟ ستتوقف أجهزته عن اعتبارها مشتركة.', none: 'لا توجد معامل مسجلة', devices: 'الأجهزة المسجلة',
    regHere: 'سجّل هذا الجهاز كجهاز معمل', thisDevice: 'هذا الجهاز', registered: 'هذا الجهاز مسجل في معمل', fail: 'تعذر التنفيذ', done: 'تم', noDev: 'لا توجد أجهزة مسجلة', removeDev: 'إزالة الجهاز',
    howto: 'لتسجيل جهاز: افتح لوحة الأدمن من جهاز المعمل نفسه، وسجّل الدخول بحساب السوبر أدمن، ثم اضغط "سجّل هذا الجهاز" داخل المعمل المطلوب.',
  },
  en: {
    title: 'Shared devices (labs)', desc: 'Register a lab by its public IP or IP range and/or register each lab machine. Any device from a lab counts as shared and never raises a "device belongs to another user" alert. A MAC address cannot be read from a browser or app, so it is not used.',
    add: 'Add lab', name: 'Lab name', location: 'Location', notes: 'Notes', ip: 'Public IP or range (e.g. 41.33.10.5 or 41.33.10.0/24)', save: 'Save', cancel: 'Cancel',
    edit: 'Edit', remove: 'Delete', confirmDel: 'Delete this lab? Its devices stop counting as shared.', none: 'No labs registered', devices: 'Registered devices',
    regHere: 'Register this device as a lab device', thisDevice: 'This device', registered: 'This device is registered in a lab', fail: 'Could not complete', done: 'Done', noDev: 'No registered devices', removeDev: 'Remove device',
    howto: 'To register a machine: open the admin panel on the lab machine itself, sign in as super admin, then press "Register this device" under the right lab.',
  },
};

const empty = { name: '', location: '', notes: '', ipCidr: '' };

export default function AdminSharedLabsSection() {
  const { locale } = useTranslations();
  const T = locale === 'en' ? TEXT.en : TEXT.ar;
  const [labs, setLabs] = useState<Lab[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  const call = useCallback(async (method: string, body?: unknown, qs = '') => {
    const headers = { ...(await getCachedAuthHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch(`/api/admin/labs${qs}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || T.fail);
    return data;
  }, [T.fail]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await call('GET');
      setLabs(d.labs || []);
      setCurrent(d.currentDevice || null);
    } catch (e) { toast.error((e as Error).message); } finally { setLoading(false); }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); toast.success(T.done); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  };

  const save = () => run('save', async () => {
    if (!form) return;
    if (editId) await call('PATCH', { id: editId, ...form }); else await call('POST', form);
    setForm(null); setEditId(null);
  });

  return (
    <div className="space-y-4" dir={locale === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-bold">{T.title}</h2><p className="max-w-3xl text-sm text-muted-foreground">{T.desc}</p><p className="mt-1 max-w-3xl text-xs text-muted-foreground">{T.howto}</p></div>
        <Button size="sm" onClick={() => { setForm(empty); setEditId(null); }}><Plus className="h-4 w-4" /> {T.add}</Button>
      </div>

      {current?.isShared && <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">{T.registered}</div>}

      {form && (
        <Card><CardContent className="grid gap-3 p-4 md:grid-cols-2">
          <label className="text-xs">{T.name}<Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-xs">{T.location}<Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          <label className="text-xs md:col-span-2">{T.ip}<Input dir="ltr" value={form.ipCidr} onChange={(e) => setForm({ ...form, ipCidr: e.target.value })} /></label>
          <label className="text-xs md:col-span-2">{T.notes}<Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="flex gap-2 md:col-span-2">
            <Button size="sm" disabled={busy === 'save'} onClick={() => void save()}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {T.save}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setForm(null); setEditId(null); }}><X className="h-4 w-4" /> {T.cancel}</Button>
          </div>
        </CardContent></Card>
      )}

      {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : labs.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{T.none}</CardContent></Card>
        : labs.map((lab) => (
          <Card key={lab.id}><CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-bold">{lab.name}</div>
                <div className="text-sm text-muted-foreground">{[lab.location, lab.ip_cidr].filter(Boolean).join(' | ')}</div>
                {lab.notes && <div className="text-xs text-muted-foreground">{lab.notes}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy === 'reg' + lab.id || !current || current.labId === lab.id} onClick={() => void run('reg' + lab.id, () => call('POST', { action: 'register_device', labId: lab.id }))}>
                  {busy === 'reg' + lab.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorSmartphone className="h-4 w-4" />} {T.regHere}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setEditId(lab.id); setForm({ name: lab.name, location: lab.location || '', notes: lab.notes || '', ipCidr: lab.ip_cidr || '' }); }}><Pencil className="h-4 w-4" /> {T.edit}</Button>
                <Button size="sm" variant="outline" disabled={busy === 'del' + lab.id} onClick={() => { if (confirm(T.confirmDel)) void run('del' + lab.id, () => call('DELETE', undefined, `?id=${lab.id}`)); }}><Trash2 className="h-4 w-4" /> {T.remove}</Button>
              </div>
            </div>
            <div className="text-xs font-semibold">{T.devices}</div>
            {lab.devices.length === 0 ? <div className="text-xs text-muted-foreground">{T.noDev}</div> : (
              <ul className="space-y-1 text-xs">
                {lab.devices.map((d) => (
                  <li key={d.device_id} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                    <span>{d.label || d.device_id.slice(0, 8)}{current?.deviceId === d.device_id ? ` (${T.thisDevice})` : ''}</span>
                    <Button size="sm" variant="ghost" disabled={busy === 'rm' + d.device_id} onClick={() => void run('rm' + d.device_id, () => call('DELETE', undefined, `?id=${lab.id}&deviceId=${encodeURIComponent(d.device_id)}`))}>{T.removeDev}</Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        ))}
    </div>
  );
}
