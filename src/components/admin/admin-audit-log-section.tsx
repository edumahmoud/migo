'use client';

/**
 * Super-admin: audit log. Read-only view of audit_events (append-only, hash-chained, kept 12 months).
 * Filters, detail view, integrity check and CSV export. Nothing here can edit or delete an event.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Download, RotateCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface AuditEvent {
  id: string; seq: number; occurred_at: string; category: string; action: string; outcome: string; severity: string;
  actor_id: string | null; actor_email: string | null; actor_role: string | null; actor_name?: string | null;
  target_type: string | null; target_id: string | null; target_label: string | null; reason: string | null;
  ip_address: string | null; user_agent: string | null; device_type: string | null; os_name: string | null;
  browser_name: string | null; device_id: string | null; client_type: string | null; mac_address: string | null; mac_note: string | null;
  before_data: unknown; after_data: unknown; changed_fields: string[] | null; metadata: unknown; source: string | null;
  row_hash: string | null; retention_until: string | null;
}
interface Stats { total: number; last24h: number; critical24h: number; failedLogins24h: number; newDeviceLogins24h: number }

// Readable names for audit action codes. Unknown codes fall back to "entity verb" words, then to the raw code.
const ACTION_AR: Record<string, string> = {
  'auth.login_success': 'تسجيل دخول ناجح', 'auth.login_failed': 'محاولة دخول فاشلة', 'auth.logout': 'تسجيل خروج',
  'user.created': 'إنشاء مستخدم', 'user.deleted': 'حذف مستخدم', 'user.updated': 'تعديل مستخدم', 'user.role_changed': 'تغيير دور مستخدم',
  'user.status_changed': 'تغيير حالة مستخدم', 'user.banned': 'حظر مستخدم', 'user.unbanned': 'رفع الحظر عن مستخدم',
  'audit.retention_purge': 'تنظيف السجلات القديمة',
  'gateway.created': 'إضافة بوابة دفع', 'gateway.updated': 'تعديل بوابة دفع', 'gateway.enabled': 'تفعيل بوابة دفع', 'gateway.disabled': 'تعطيل بوابة دفع',
  'gateway.default_changed': 'تغيير بوابة الدفع الافتراضية', 'gateway.connection_tested': 'اختبار اتصال بوابة دفع',
  'payout.created': 'إنشاء طلب سحب', 'payout.processing': 'سحب قيد المعالجة', 'payout.completed': 'اكتمال السحب', 'payout.failed': 'فشل السحب', 'payout.cancelled': 'إلغاء السحب',
  'payout_method.created': 'إضافة وسيلة سحب', 'payout_method.updated': 'تعديل وسيلة سحب', 'payout_method.deleted': 'حذف وسيلة سحب', 'payout_method.disabled': 'تعطيل وسيلة سحب',
  'payout_method.reenabled': 'إعادة تفعيل وسيلة سحب', 'payout_method.set_default': 'تعيين وسيلة سحب افتراضية', 'payout_method.verified': 'توثيق وسيلة سحب',
};
const ACTION_EN: Record<string, string> = {
  'auth.login_success': 'Successful sign-in', 'auth.login_failed': 'Failed sign-in', 'auth.logout': 'Sign-out',
  'user.created': 'User created', 'user.deleted': 'User deleted', 'user.updated': 'User updated', 'user.role_changed': 'User role changed',
  'user.status_changed': 'User status changed', 'user.banned': 'User banned', 'user.unbanned': 'User unbanned',
  'audit.retention_purge': 'Old logs purged',
  'gateway.created': 'Payment gateway added', 'gateway.updated': 'Payment gateway updated', 'gateway.enabled': 'Payment gateway enabled', 'gateway.disabled': 'Payment gateway disabled',
  'gateway.default_changed': 'Default gateway changed', 'gateway.connection_tested': 'Gateway connection tested',
  'payout.created': 'Payout requested', 'payout.processing': 'Payout processing', 'payout.completed': 'Payout completed', 'payout.failed': 'Payout failed', 'payout.cancelled': 'Payout cancelled',
  'payout_method.created': 'Payout method added', 'payout_method.updated': 'Payout method updated', 'payout_method.deleted': 'Payout method deleted', 'payout_method.disabled': 'Payout method disabled',
  'payout_method.reenabled': 'Payout method re-enabled', 'payout_method.set_default': 'Default payout method set', 'payout_method.verified': 'Payout method verified',
};
function actionLabel(code: string, locale: string): string {
  const map = locale === 'en' ? ACTION_EN : ACTION_AR;
  return map[code] || code;
}

const TEXT = {
  ar: {
    title: 'سجل التدقيق', desc: 'سجل لا يمكن تعديله أو حذفه لكل الأحداث الحساسة، محفوظ 12 شهرًا. للسوبر أدمن فقط.',
    total: 'إجمالي الأحداث', last24: 'آخر 24 ساعة', crit: 'حرجة (24 ساعة)', failed: 'محاولات دخول فاشلة (24 ساعة)', newDev: 'دخول من جهاز جديد (24 ساعة)',
    category: 'الفئة', outcome: 'النتيجة', severity: 'الخطورة', all: 'الكل', search: 'بحث', actor: 'المستخدم (إيميل أو ID)', ip: 'IP', device: 'معرّف الجهاز', from: 'من', to: 'إلى',
    apply: 'تطبيق', reset: 'مسح', verify: 'فحص سلامة السجل', export: 'تصدير CSV', refresh: 'تحديث',
    time: 'الوقت', who: 'المستخدم', action: 'الحدث', target: 'الهدف', dev: 'الجهاز', none: 'لا توجد أحداث', prev: 'السابق', next: 'التالي', page: 'صفحة',
    ok: 'السجل سليم: لم يتم العبث بأي حدث', bad: 'تحذير: تم اكتشاف خلل في سلسلة السجل', checked: 'حدث تم فحصه',
    details: 'التفاصيل', close: 'إغلاق', before: 'قبل', after: 'بعد', changed: 'الحقول المتغيرة', meta: 'بيانات إضافية', hash: 'بصمة الحدث',
    mac: 'عنوان MAC', macNA: 'غير متاح: المتصفحات والتطبيقات لا تستطيع قراءته والسيرفر لا يراه، وأندرويد الحديث يغيّره عشوائيًا. نستخدم معرّف الجهاز بدلًا منه.',
    ua: 'User agent', retention: 'يحفظ حتى', system: 'النظام', unknown: 'غير معروف', fail: 'تعذر التحميل',
    outcomes: { success: 'نجاح', failure: 'فشل', denied: 'مرفوض' } as Record<string, string>,
    sev: { info: 'عادي', notice: 'ملاحظة', warning: 'تحذير', critical: 'حرج' } as Record<string, string>,
  },
  en: {
    title: 'Audit log', desc: 'Tamper-proof record (append-only, hash-chained) of sensitive events, kept 12 months. Super admin only.',
    total: 'Total events', last24: 'Last 24 hours', crit: 'Critical (24h)', failed: 'Failed logins (24h)', newDev: 'New-device logins (24h)',
    category: 'Category', outcome: 'Outcome', severity: 'Severity', all: 'All', search: 'Search', actor: 'User (email or ID)', ip: 'IP', device: 'Device ID', from: 'From', to: 'To',
    apply: 'Apply', reset: 'Clear', verify: 'Verify integrity', export: 'Export CSV', refresh: 'Refresh',
    time: 'Time', who: 'User', action: 'Event', target: 'Target', dev: 'Device', none: 'No events', prev: 'Previous', next: 'Next', page: 'Page',
    ok: 'Log is intact: no event has been altered', bad: 'Warning: the log chain is broken', checked: 'events checked',
    details: 'Details', close: 'Close', before: 'Before', after: 'After', changed: 'Changed fields', meta: 'Extra data', hash: 'Event hash',
    mac: 'MAC address', macNA: 'Not available: browsers and apps cannot read it, the server never sees it, and modern Android randomizes it. The device ID is used instead.',
    ua: 'User agent', retention: 'Kept until', system: 'System', unknown: 'Unknown', fail: 'Could not load',
    outcomes: { success: 'Success', failure: 'Failure', denied: 'Denied' } as Record<string, string>,
    sev: { info: 'Info', notice: 'Notice', warning: 'Warning', critical: 'Critical' } as Record<string, string>,
  },
};

const CATEGORIES = ['auth', 'user', 'finance', 'content', 'config', 'security', 'system'];
const SEV_STYLE: Record<string, string> = {
  info: 'bg-slate-100 text-slate-700', notice: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-800', critical: 'bg-red-100 text-red-700',
};

const emptyFilters = { category: '', outcome: '', severity: '', actor: '', ip: '', deviceId: '', q: '', from: '', to: '' };

export default function AdminAuditLogSection() {
  const { locale } = useTranslations();
  const T = locale === 'en' ? TEXT.en : TEXT.ar;
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'verify' | 'export'>('');
  const [integrity, setIntegrity] = useState<{ ok: boolean; checked?: number } | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const pageSize = 25;

  const qs = useCallback((f: typeof emptyFilters, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v); });
    Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getCachedAuthHeaders();
      const [res, sres] = await Promise.all([
        fetch(`/api/admin/audit?${qs(applied, { page: String(page), pageSize: String(pageSize) })}`, { headers }),
        fetch('/api/admin/audit?stats=1', { headers }),
      ]);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'fail');
      setEvents(data.events || []);
      setTotal(data.total || 0);
      const sd = await sres.json().catch(() => null);
      if (sd?.success) setStats(sd.stats);
    } catch {
      toast.error(T.fail);
    } finally {
      setLoading(false);
    }
  }, [applied, page, qs, T.fail]);

  useEffect(() => { void load(); }, [load]);

  const verify = async () => {
    setBusy('verify');
    try {
      const res = await fetch('/api/admin/audit?verify=1', { headers: await getCachedAuthHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error();
      setIntegrity({ ok: !!data.integrity?.ok, checked: data.integrity?.checked });
    } catch { toast.error(T.fail); } finally { setBusy(''); }
  };

  const exportCsv = async () => {
    setBusy('export');
    try {
      const res = await fetch(`/api/admin/audit?${qs(applied, { format: 'csv' })}`, { headers: await getCachedAuthHeaders() });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error(T.fail); } finally { setBusy(''); }
  };

  const fmt = (s: string) => new Date(s).toLocaleString(locale === 'en' ? 'en-GB' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'medium' });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const set = (k: keyof typeof emptyFilters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
  const json = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v, null, 2));

  const statCards: [string, number | undefined][] = [
    [T.total, stats?.total], [T.last24, stats?.last24h], [T.crit, stats?.critical24h], [T.failed, stats?.failedLogins24h], [T.newDev, stats?.newDeviceLogins24h],
  ];

  return (
    <div className="space-y-4" dir={locale === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{T.title}</h2>
          <p className="text-sm text-muted-foreground">{T.desc}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RotateCw className="h-4 w-4" /> {T.refresh}</Button>
          <Button variant="outline" size="sm" onClick={() => void verify()} disabled={busy !== ''}>
            {busy === 'verify' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {T.verify}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={busy !== ''}>
            {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {T.export}
          </Button>
        </div>
      </div>

      {integrity && (
        <div className={`rounded-md border p-3 text-sm ${integrity.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
          {integrity.ok ? T.ok : T.bad}{integrity.checked !== undefined ? ` (${integrity.checked} ${T.checked})` : ''}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {statCards.map(([label, value]) => (
          <Card key={label}><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold">{value === undefined ? '...' : value}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
          <label className="text-xs">{T.category}
            <select className={selectCls} value={filters.category} onChange={set('category')}>
              <option value="">{T.all}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="text-xs">{T.outcome}
            <select className={selectCls} value={filters.outcome} onChange={set('outcome')}>
              <option value="">{T.all}</option>{Object.entries(T.outcomes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="text-xs">{T.severity}
            <select className={selectCls} value={filters.severity} onChange={set('severity')}>
              <option value="">{T.all}</option>{Object.entries(T.sev).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label className="text-xs">{T.search}<Input value={filters.q} onChange={set('q')} /></label>
          <label className="text-xs">{T.actor}<Input value={filters.actor} onChange={set('actor')} /></label>
          <label className="text-xs">{T.ip}<Input value={filters.ip} onChange={set('ip')} /></label>
          <label className="text-xs">{T.device}<Input value={filters.deviceId} onChange={set('deviceId')} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">{T.from}<Input type="date" value={filters.from} onChange={set('from')} /></label>
            <label className="text-xs">{T.to}<Input type="date" value={filters.to} onChange={set('to')} /></label>
          </div>
          <div className="col-span-2 flex gap-2 md:col-span-4">
            <Button size="sm" onClick={() => { setPage(1); setApplied(filters); }}><Search className="h-4 w-4" /> {T.apply}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setFilters(emptyFilters); setApplied(emptyFilters); setPage(1); }}><X className="h-4 w-4" /> {T.reset}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{total} {T.title}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{T.none}</div>
          ) : (
            <table className="w-full table-fixed text-sm md:table-auto">
              <thead className="bg-muted/50 text-xs">
                <tr className="text-start">
                  {[T.severity, T.time, T.who, T.action, T.target, T.ip, T.dev].map((h, i) => <th key={h} className={`p-2 text-start font-medium ${i >= 5 ? 'hidden lg:table-cell' : ''}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setSelected(ev)}>
                    <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${SEV_STYLE[ev.severity] || SEV_STYLE.info}`}>{T.sev[ev.severity] || ev.severity}</span></td>
                    <td className="p-2 text-xs md:whitespace-nowrap">{fmt(ev.occurred_at)}</td>
                    <td className="p-2">{ev.actor_name || ev.actor_email || (ev.actor_id ? ev.actor_id.slice(0, 8) : T.system)}</td>
                    <td className="p-2"><div className="text-xs font-medium" title={ev.action}>{actionLabel(ev.action, locale)}</div><div className="font-mono text-[10px] text-muted-foreground" dir="ltr">{ev.action}</div><div className="text-xs text-muted-foreground">{T.outcomes[ev.outcome] || ev.outcome}</div></td>
                    <td className="max-w-[120px] truncate p-2 md:max-w-[200px]">{ev.target_label || ev.target_type || '-'}</td>
                    <td className="hidden p-2 font-mono text-xs lg:table-cell">{ev.ip_address || '-'}</td>
                    <td className="hidden p-2 text-xs lg:table-cell">{[ev.device_type, ev.os_name, ev.browser_name].filter(Boolean).join(' / ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>{T.prev}</Button>
        <span>{T.page} {page} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>{T.next}</Button>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-4 shadow-xl" dir={locale === 'en' ? 'ltr' : 'rtl'} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">{T.details} #{selected.seq}</h3>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}><X className="h-4 w-4" /></Button>
            </div>
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm">
              {([
                [T.time, fmt(selected.occurred_at)],
                [T.action, `${actionLabel(selected.action, locale)} (${selected.action})`],
                [T.outcome, T.outcomes[selected.outcome] || selected.outcome],
                [T.severity, T.sev[selected.severity] || selected.severity],
                [T.who, [selected.actor_name, selected.actor_email, selected.actor_id].filter(Boolean).join(' | ') || T.system],
                [T.target, [selected.target_type, selected.target_label, selected.target_id].filter(Boolean).join(' | ') || '-'],
                [T.ip, selected.ip_address || '-'],
                [T.dev, [selected.device_type, selected.os_name, selected.browser_name, selected.client_type].filter(Boolean).join(' / ') || '-'],
                [T.device, selected.device_id || '-'],
                [T.ua, selected.user_agent || '-'],
                [T.retention, selected.retention_until ? fmt(selected.retention_until) : '-'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v}</dd></div>
              ))}
              <dt className="text-muted-foreground">{T.mac}</dt><dd className="text-xs text-amber-700">{selected.mac_address || T.macNA}</dd>
            </dl>
            {selected.changed_fields && selected.changed_fields.length > 0 && (
              <p className="mt-3 text-sm"><b>{T.changed}:</b> {selected.changed_fields.join(', ')}</p>
            )}
            {(['before_data', 'after_data', 'metadata'] as const).map((k) => selected[k] ? (
              <div key={k} className="mt-3">
                <div className="mb-1 text-xs font-semibold">{k === 'before_data' ? T.before : k === 'after_data' ? T.after : T.meta}</div>
                <pre dir="ltr" className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{json(selected[k])}</pre>
              </div>
            ) : null)}
            <p className="mt-3 break-all font-mono text-[10px] text-muted-foreground">{T.hash}: {selected.row_hash}</p>
          </div>
        </div>
      )}
    </div>
  );
}
