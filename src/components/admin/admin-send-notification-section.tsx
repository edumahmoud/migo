'use client';

/**
 * Admin: send a notification to everyone or to a category (teachers, students, admins,
 * one subject's students, or specific users). Shows the recipient count before sending.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Search, X, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

type Audience = 'all' | 'teachers' | 'students' | 'admins' | 'subject' | 'users';
interface SubjectRow { id: string; name: string; level?: string | null; sub_level?: string | null }
interface UserRow { id: string; name: string; email: string; role: string }

const TEXT = {
  ar: {
    title: 'إرسال إشعار', desc: 'أرسل إشعارًا (داخل التطبيق + إشعار على الموبايل) لكل المستخدمين أو لفئة محددة.',
    audience: 'المستلمون', all: 'كل المستخدمين', teachers: 'المعلمون', students: 'الطلاب', admins: 'الأدمن',
    subject: 'طلاب مادة', users: 'مستخدمون محددون', pickSubject: 'اختر المادة', search: 'ابحث بالاسم أو الإيميل أو الكود',
    ttl: 'العنوان', msg: 'الرسالة', recipients: 'عدد المستلمين', send: 'إرسال', confirm: 'تأكيد الإرسال', cancel: 'إلغاء',
    sentTo: 'تم الإرسال إلى', none: 'لا يوجد مستلمون', fill: 'اكتب العنوان والرسالة', fail: 'تعذر الإرسال',
    history: 'سجل الإشعارات المرسلة', noHistory: 'لا توجد إشعارات مرسلة بعد', resend: 'إعادة إرسال', by: 'بواسطة', resentTag: 'إعادة إرسال',
    resendConfirm: (n: number) => `سيتم إعادة إرسال هذا الإشعار إلى ${n} مستخدم حاليًا في نفس الفئة.`,
    aud: { all: 'كل المستخدمين', teachers: 'المعلمون', students: 'الطلاب', admins: 'الأدمن', subject: 'طلاب مادة', users: 'مستخدمون محددون' } as Record<string, string>,
    confirmText: (n: number) => `سيتم إرسال الإشعار إلى ${n} مستخدم. لا يمكن التراجع بعد الإرسال.`,
  },
  en: {
    title: 'Send notification', desc: 'Send a notification (in-app + phone push) to everyone or a specific group.',
    audience: 'Recipients', all: 'All users', teachers: 'Teachers', students: 'Students', admins: 'Admins',
    subject: "A subject's students", users: 'Specific users', pickSubject: 'Choose a subject', search: 'Search by name, email or code',
    ttl: 'Title', msg: 'Message', recipients: 'Recipients', send: 'Send', confirm: 'Confirm send', cancel: 'Cancel',
    sentTo: 'Sent to', none: 'No recipients', fill: 'Enter a title and message', fail: 'Could not send',
    history: 'Sent notifications log', noHistory: 'Nothing sent yet', resend: 'Resend', by: 'By', resentTag: 'Resend',
    resendConfirm: (n: number) => `This will resend to ${n} user(s) currently in the same audience.`,
    aud: { all: 'All users', teachers: 'Teachers', students: 'Students', admins: 'Admins', subject: "A subject's students", users: 'Specific users' } as Record<string, string>,
    confirmText: (n: number) => `This will notify ${n} user(s). It cannot be undone.`,
  },
};

export default function AdminSendNotificationSection() {
  const { locale } = useTranslations();
  const L = locale === 'en' ? TEXT.en : TEXT.ar;
  const [audience, setAudience] = useState<Audience>('all');
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<UserRow[]>([]);
  const [picked, setPicked] = useState<UserRow[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  interface LogRow { id: string; audience: string; title: string; message: string; recipient_count: number; resent_from: string | null; created_at: string; sender_name: string | null }
  const [log, setLog] = useState<LogRow[]>([]);
  const [resendId, setResendId] = useState<string | null>(null);
  const [resendCount, setResendCount] = useState<number | null>(null);

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/notifications/send?resource=history', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.success) setLog(json.data);
    } catch { /* log stays as is */ }
  }, []);
  useEffect(() => { loadLog(); }, [loadLog]);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/admin/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      body: JSON.stringify(payload),
    });
    return res.json();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/notifications/send?resource=subjects', { headers: await getCachedAuthHeaders() });
        const json = await res.json();
        if (json.success) setSubjects(json.data);
      } catch { /* picker stays empty */ }
    })();
  }, []);

  useEffect(() => {
    if (audience !== 'users' || query.trim().length < 2) { setFound([]); return; }
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/notifications/send?resource=users&q=${encodeURIComponent(query.trim())}`, { headers: await getCachedAuthHeaders() });
        const json = await res.json();
        if (json.success) setFound(json.data);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(h);
  }, [query, audience]);

  const target = { audience, subjectId: subjectId || undefined, userIds: picked.map((u) => u.id) };

  // Live recipient count for the chosen audience.
  useEffect(() => {
    setConfirming(false);
    if ((audience === 'subject' && !subjectId) || (audience === 'users' && picked.length === 0)) { setCount(null); return; }
    let live = true;
    call({ ...target, dryRun: true }).then((j) => { if (live) setCount(j.success ? j.count : null); }).catch(() => {});
    return () => { live = false; };
  }, [audience, subjectId, picked, call]);

  const send = async () => {
    setBusy(true);
    try {
      const json = await call({ ...target, title, message });
      if (json.success) {
        toast.success(`${L.sentTo} ${json.count}`);
        setTitle(''); setMessage(''); setConfirming(false);
        loadLog();
      } else {
        toast.error(json.error || L.fail);
      }
    } catch {
      toast.error(L.fail);
    } finally {
      setBusy(false);
    }
  };

  const startResend = async (id: string) => {
    setResendId(id); setResendCount(null);
    try {
      const j = await call({ resendLogId: id, dryRun: true });
      setResendCount(j.success ? j.count : 0);
    } catch { setResendCount(0); }
  };
  const doResend = async () => {
    if (!resendId) return;
    setBusy(true);
    try {
      const json = await call({ resendLogId: resendId });
      if (json.success) { toast.success(`${L.sentTo} ${json.count}`); setResendId(null); loadLog(); }
      else toast.error(json.error || L.fail);
    } catch { toast.error(L.fail); } finally { setBusy(false); }
  };

  const audiences: { id: Audience; label: string }[] = [
    { id: 'all', label: L.all }, { id: 'teachers', label: L.teachers }, { id: 'students', label: L.students },
    { id: 'admins', label: L.admins }, { id: 'subject', label: L.subject }, { id: 'users', label: L.users },
  ];
  const canSend = title.trim() && message.trim() && count !== null && count > 0;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">{L.title}</h2>
        <p className="text-muted-foreground mt-1">{L.desc}</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">{L.audience}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {audiences.map((a) => (
              <Button key={a.id} type="button" size="sm" variant={audience === a.id ? 'default' : 'outline'} onClick={() => setAudience(a.id)}>
                {a.label}
              </Button>
            ))}
          </div>

          {audience === 'subject' && (
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">{L.pickSubject}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.level ? ` - ${s.level}` : ''}</option>
              ))}
            </select>
          )}

          {audience === 'users' && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="ps-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L.search} />
              </div>
              {found.length > 0 && (
                <div className="rounded-md border divide-y max-h-48 overflow-auto">
                  {found.filter((u) => !picked.some((p) => p.id === u.id)).map((u) => (
                    <button key={u.id} type="button" className="w-full text-start px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => { setPicked((p) => [...p, u]); setQuery(''); setFound([]); }}>
                      {u.name} <span className="text-muted-foreground">({u.role}) {u.email}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {picked.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs">
                    {u.name}
                    <button type="button" aria-label="remove" onClick={() => setPicked((p) => p.filter((x) => x.id !== u.id))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {L.recipients}: <span className="font-semibold text-foreground">{count === null ? '-' : count}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={L.ttl} />
          <Textarea value={message} maxLength={1000} rows={4} onChange={(e) => setMessage(e.target.value)} placeholder={L.msg} />
          {!confirming ? (
            <Button type="button" disabled={!canSend} onClick={() => (canSend ? setConfirming(true) : toast.error(count === 0 ? L.none : L.fill))}>
              <Send className="h-4 w-4 me-2" /> {L.send}
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
              <p className="text-sm">{L.confirmText(count ?? 0)}</p>
              <div className="flex gap-2">
                <Button type="button" disabled={busy} onClick={send}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Send className="h-4 w-4 me-2" />} {L.confirm}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{L.cancel}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{L.history}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {log.length === 0 && <p className="text-sm text-muted-foreground">{L.noHistory}</p>}
          {log.map((r) => (
            <div key={r.id} className="rounded-md border p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{r.title}{r.resent_from ? <span className="ms-2 text-xs text-muted-foreground">({L.resentTag})</span> : null}</p>
                  <p className="text-sm text-muted-foreground break-words">{r.message}</p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => startResend(r.id)}>
                  <RotateCw className="h-3.5 w-3.5 me-1" /> {L.resend}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {L.aud[r.audience] ?? r.audience} · {L.recipients}: {r.recipient_count} · {new Date(r.created_at).toLocaleString(locale === 'en' ? 'en-GB' : 'ar-EG')}{r.sender_name ? ` · ${L.by} ${r.sender_name}` : ''}
              </p>
              {resendId === r.id && (
                <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                  <p className="text-sm">{resendCount === null ? '...' : resendCount === 0 ? L.none : L.resendConfirm(resendCount)}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={busy || !resendCount} onClick={doResend}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Send className="h-4 w-4 me-2" />} {L.confirm}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setResendId(null)}>{L.cancel}</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
