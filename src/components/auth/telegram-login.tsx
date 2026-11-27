'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const RESEND_SECONDS = 45;

/** Login with a 6-digit code sent by the AttenDo Telegram bot to the chat linked at phone verification. */
export default function TelegramLogin({
  initialEmail,
  onBack,
  onLoggedIn,
}: {
  initialEmail: string;
  onBack: () => void;
  onLoggedIn: (email: string, tokenHash: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<0 | 1>(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const sentRef = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const validEmail = email.trim().includes('@') && email.trim().length > 4;

  const send = async () => {
    if (!validEmail || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/tg-login/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error || 'تعذر الإرسال، حاول تاني'); return; }
      setStep(1);
      setCode('');
      setWait(RESEND_SECONDS);
      sentRef.current = true;
    } catch {
      setError('مفيش اتصال بالنت، تأكد وحاول تاني');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c: string) => {
    if (c.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/tg-login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: c }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.tokenHash) {
        setError(j.error || 'الكود غير صحيح');
        setCode('');
        return;
      }
      await onLoggedIn(j.email, j.tokenHash);
    } catch {
      setError('مفيش اتصال بالنت، تأكد وحاول تاني');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h3 className="text-base font-semibold">الدخول بكود تليجرام</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {step === 0
            ? 'هنبعتلك كود من بوت AttenDo على تليجرام. بيشتغل بس لو ربطت حسابك بالبوت وقت التسجيل.'
            : 'لو حسابك مربوط بالبوت هيوصلك كود من 6 أرقام خلال ثواني. افتح تليجرام وانسخه هنا.'}
        </p>
      </div>

      {step === 0 ? (
        <div className="space-y-2">
          <Label htmlFor="tg-email" className="text-xs sm:text-sm">الإيميل</Label>
          <Input
            id="tg-email"
            type="email"
            dir="ltr"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            disabled={busy}
            maxLength={254}
            className="h-11"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" dir="ltr">{email.trim()}</p>
          <Input
            dir="ltr"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="______"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(v);
              if (v.length === 6) void verify(v);
            }}
            disabled={busy}
            className="h-12 text-center text-xl tracking-[0.5em]"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {step === 0 ? (
        <Button type="button" onClick={send} disabled={!validEmail || busy} className="w-full h-11 bg-gradient-to-l from-sky-700 to-teal-600 text-white">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'ابعت الكود'}
        </Button>
      ) : (
        <div className="space-y-2">
          <Button type="button" onClick={() => verify(code)} disabled={code.length !== 6 || busy} className="w-full h-11 bg-gradient-to-l from-sky-700 to-teal-600 text-white">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'دخول'}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={send} disabled={wait > 0 || busy} className="font-medium text-sky-700 disabled:text-muted-foreground">
              {wait > 0 ? `إعادة الإرسال بعد ${wait} ثانية` : 'إعادة إرسال الكود'}
            </button>
            <button type="button" onClick={() => { setStep(0); setError(null); setCode(''); }} disabled={busy} className="text-muted-foreground">
              تغيير الإيميل
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={onBack} disabled={busy} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">
        الرجوع للدخول بالباسورد
      </button>
    </div>
  );
}
