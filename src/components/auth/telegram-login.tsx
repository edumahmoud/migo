'use client';

import { tr } from '@/lib/tr';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
      if (!res.ok) { setError(j.error || tr('تعذر الإرسال، حاول تاني', 'Could not send, try again')); return; }
      setStep(1);
      setCode('');
      setWait(RESEND_SECONDS);
      sentRef.current = true;
    } catch {
      setError(tr('مفيش اتصال بالنت، تأكد وحاول تاني', 'No internet connection, check and try again'));
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
        setError(j.error || tr('الكود غير صحيح', 'Incorrect code'));
        setCode('');
        return;
      }
      await onLoggedIn(j.email, j.tokenHash);
    } catch {
      setError(tr('مفيش اتصال بالنت، تأكد وحاول تاني', 'No internet connection, check and try again'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h3 className="text-base font-semibold">{tr('الدخول بكود تليجرام', 'Login with a Telegram code')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {step === 0
            ? tr('هنبعتلك كود من بوت AttenDo على تليجرام. بيشتغل بس لو ربطت حسابك بالبوت وقت التسجيل.', 'We will send you a code from the AttenDo Telegram bot. It only works if you linked your account to the bot when you signed up.')
            : tr('لو حسابك مربوط بالبوت هيوصلك كود من 6 أرقام خلال ثواني. افتح تليجرام وانسخه هنا.', 'If your account is linked to the bot you will get a 6-digit code in a few seconds. Open Telegram and enter it here.')}
        </p>
      </div>

      {step === 0 ? (
        <div className="space-y-2">
          <Label htmlFor="tg-email" className="text-xs sm:text-sm">{tr('الإيميل', 'Email')}</Label>
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
          <div className="relative" dir="ltr">
            <div className="flex items-center justify-center gap-2 sm:gap-3" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => {
                const ch = code[i];
                const active = !busy && i === Math.min(code.length, 5);
                return (
                  <motion.div
                    key={i}
                    animate={{ scale: ch ? 1.06 : 1, backgroundColor: active ? 'rgba(14,165,233,0.14)' : ch ? 'rgba(14,165,233,0.08)' : 'rgba(148,163,184,0.16)' }}
                    transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                    className="h-12 w-10 sm:h-14 sm:w-12 rounded-xl flex items-center justify-center text-xl sm:text-2xl font-semibold text-foreground"
                  >
                    <AnimatePresence mode="popLayout" initial={false}>
                      {ch ? (
                        <motion.span key={ch + i} initial={{ y: 10, opacity: 0, scale: 0.6 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.16 }}>
                          {ch}
                        </motion.span>
                      ) : active ? (
                        <motion.span key="caret" className="h-6 w-0.5 rounded bg-sky-600" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
            <input
              dir="ltr"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={tr('كود التحقق', 'Verification code')}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
              disabled={busy}
              className="absolute inset-0 h-full w-full opacity-0 cursor-text caret-transparent border-0 outline-none bg-transparent"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {step === 0 ? (
        <Button type="button" onClick={send} disabled={!validEmail || busy} className="w-full h-11 bg-gradient-to-l from-sky-700 to-teal-600 text-white">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : tr('ابعت الكود', 'Send code')}
        </Button>
      ) : (
        <div className="space-y-2">
          <Button type="button" onClick={() => verify(code)} disabled={code.length !== 6 || busy} className="w-full h-11 bg-gradient-to-l from-sky-700 to-teal-600 text-white">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : tr('دخول', 'Login')}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={send} disabled={wait > 0 || busy} className="font-medium text-sky-700 disabled:text-muted-foreground">
              {wait > 0 ? tr(`إعادة الإرسال بعد ${wait} ثانية`, `Resend in ${wait}s`) : tr('إعادة إرسال الكود', 'Resend code')}
            </button>
            <button type="button" onClick={() => { setStep(0); setError(null); setCode(''); }} disabled={busy} className="text-muted-foreground">
              {tr('تغيير الإيميل', 'Change email')}
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={onBack} disabled={busy} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">
        {tr('الرجوع للدخول بالباسورد', 'Back to password login')}
      </button>
    </div>
  );
}
