'use client';

/**
 * Teacher: device alerts for exams and attendance. Shows who used whose device, from which device,
 * in which exam or session. Alerts only flag: nothing is blocked or penalised automatically.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

interface Person { name?: string; email?: string }
interface Alert {
  id: string; created_at: string; kind: string; severity: 'strong' | 'review'; context_type: 'attendance' | 'quiz';
  context_label: string | null; subject_name: string | null; status: 'open' | 'false_alarm';
  account: Person | null; device_owner: Person | null; other_account: Person | null;
  device_id: string | null; device_label: string | null; other_device_label: string | null; other_device_id: string | null;
  summary: string | null;
}

const TEXT = {
  ar: {
    title: 'تنبيهات الأجهزة', desc: 'تنبيهات عن احتمال غش في الامتحانات أو تزييف الحضور. التنبيه لا يمنع الطالب ولا يعاقبه، والقرار لك.',
    open: 'مفتوحة', falseAlarm: 'إنذارات كاذبة', refresh: 'تحديث', none: 'لا توجد تنبيهات',
    time: 'الوقت', session: 'الامتحان / الحصة', account: 'الحساب المستخدم', device: 'الجهاز', owner: 'صاحب الجهاز', other: 'الطرف الآخر',
    sev: 'الخطورة', what: 'ما حدث', action: 'إجراء', strong: 'قوي', review: 'للمراجعة', mark: 'إنذار كاذب', reopen: 'إعادة فتح',
    exam: 'امتحان', att: 'حضور', fail: 'تعذر التحميل', done: 'تم', unknownDev: 'جهاز غير معروف',
    kinds: {
      device_owner_mismatch: 'جهاز صاحبه مختلف عن الحساب المستخدم',
      device_shared_in_session: 'نفس الجهاز لحسابين في نفس الجلسة',
      account_on_two_devices: 'نفس الحساب على جهازين',
      unusual_device: 'جهاز غير معتاد للطالب',
      many_devices_or_ips: 'تغيّر كثير في الأجهزة أو الـ IP',
    } as Record<string, string>,
  },
  en: {
    title: 'Device alerts', desc: 'Alerts about possible cheating in exams or faked attendance. An alert never blocks or penalises a student; the decision is yours.',
    open: 'Open', falseAlarm: 'False alarms', refresh: 'Refresh', none: 'No alerts',
    time: 'Time', session: 'Exam / session', account: 'Account used', device: 'Device', owner: 'Device owner', other: 'Other party',
    sev: 'Severity', what: 'What happened', action: 'Action', strong: 'Strong', review: 'Review', mark: 'False alarm', reopen: 'Reopen',
    exam: 'Exam', att: 'Attendance', fail: 'Could not load', done: 'Done', unknownDev: 'Unknown device',
    kinds: {
      device_owner_mismatch: "Device belongs to a different account than the one used",
      device_shared_in_session: 'Same device used by two accounts in one session',
      account_on_two_devices: 'Same account on two devices',
      unusual_device: "Device unusual for this student",
      many_devices_or_ips: 'Many device or IP changes',
    } as Record<string, string>,
  },
};

export default function CheatAlertsSection() {
  const { locale } = useTranslations();
  const T = locale === 'en' ? TEXT.en : TEXT.ar;
  const [tab, setTab] = useState<'open' | 'false_alarm'>('open');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teacher/cheat-alerts?status=${tab}`, { headers: await getCachedAuthHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error();
      setAlerts(data.alerts || []);
    } catch { toast.error(T.fail); } finally { setLoading(false); }
  }, [tab, T.fail]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (id: string, status: 'open' | 'false_alarm') => {
    setBusyId(id);
    try {
      const headers = { ...(await getCachedAuthHeaders()), 'Content-Type': 'application/json' };
      const res = await fetch('/api/teacher/cheat-alerts', { method: 'PATCH', headers, body: JSON.stringify({ id, status }) });
      if (!res.ok) throw new Error();
      toast.success(T.done);
      setAlerts((a) => a.filter((x) => x.id !== id));
    } catch { toast.error(T.fail); } finally { setBusyId(''); }
  };

  const who = (p: Person | null) => (p ? p.name || p.email || '?' : '-');
  const dev = (label: string | null, id: string | null) => label || (id ? id.slice(0, 8) : T.unknownDev);
  const fmt = (s: string) => new Date(s).toLocaleString(locale === 'en' ? 'en-GB' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="space-y-4" dir={locale === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-1 h-6 w-6 text-amber-600" />
          <div><h2 className="text-xl font-bold">{T.title}</h2><p className="text-sm text-muted-foreground">{T.desc}</p></div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={tab === 'open' ? 'default' : 'outline'} onClick={() => setTab('open')}>{T.open}</Button>
          <Button size="sm" variant={tab === 'false_alarm' ? 'default' : 'outline'} onClick={() => setTab('false_alarm')}>{T.falseAlarm}</Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RotateCw className="h-4 w-4" /> {T.refresh}</Button>
        </div>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{T.none}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>{[T.sev, T.time, T.session, T.what, T.account, T.device, T.owner, T.other, T.action].map((h) => <th key={h} className="p-2 text-start font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-t align-top">
                    <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${a.severity === 'strong' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{a.severity === 'strong' ? T.strong : T.review}</span></td>
                    <td className="whitespace-nowrap p-2">{fmt(a.created_at)}</td>
                    <td className="p-2"><div>{a.context_label || '-'}</div><div className="text-xs text-muted-foreground">{a.context_type === 'quiz' ? T.exam : T.att}{a.subject_name ? ` - ${a.subject_name}` : ''}</div></td>
                    <td className="max-w-[260px] p-2"><div className="font-medium">{T.kinds[a.kind] || a.kind}</div>{a.summary && <div className="text-xs text-muted-foreground">{a.summary}</div>}</td>
                    <td className="p-2">{who(a.account)}</td>
                    <td className="p-2 text-xs">{dev(a.device_label, a.device_id)}{a.other_device_id ? <div className="text-muted-foreground">+ {dev(a.other_device_label, a.other_device_id)}</div> : null}</td>
                    <td className="p-2">{who(a.device_owner)}</td>
                    <td className="p-2">{a.other_account ? who(a.other_account) : '-'}</td>
                    <td className="p-2">
                      <Button size="sm" variant="outline" disabled={busyId === a.id} onClick={() => void setStatus(a.id, a.status === 'open' ? 'false_alarm' : 'open')}>
                        {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : a.status === 'open' ? T.mark : T.reopen}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
