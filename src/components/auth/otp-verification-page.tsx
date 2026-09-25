'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, RefreshCw, LogOut, CheckCircle2, Phone, Send, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import { normalizePhoneToE164 } from '@/lib/phone-utils';

type SessionStatus =
  | 'loading'           // initial load
  | 'pending_start'     // waiting for user to click Start in Telegram
  | 'otp_sent'          // OTP sent to Telegram, user should enter it
  | 'verified'          // success — phone verified
  | 'expired'           // session timed out
  | 'init_error'        // failed to create session
  | 'bot_not_configured'; // env vars missing

export default function OtpVerificationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut, user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [initiating, setInitiating] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const phone = (user as { phone?: string } | null)?.phone ?? null;

  // 1. Initiate verification session on mount
  const init = useCallback(async () => {
    setInitiating(true);
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/auth/initiate-telegram-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        setDeepLink(json.deep_link);
        setBotUsername(json.bot_username);
        setStatus('pending_start');
        setCooldown(60);
      } else {
        setStatus('init_error');
        setErrorMessage(json.error || 'تعذّر بدء جلسة التحقق');
      }
    } catch {
      setStatus('init_error');
      setErrorMessage(t('common.unexpectedError'));
    } finally {
      setInitiating(false);
    }
  }, [t]);

  useEffect(() => { init(); }, [init]);

  // 2. Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // 3. Poll /api/auth/verification-status while status === 'pending_start'
  //    (no page reload — just internal state update)
  useEffect(() => {
    if (status !== 'pending_start') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/verification-status', {
          headers: await getCachedAuthHeaders(),
        });
        const json = await res.json();
        if (json.status === 'otp_sent') {
          setStatus('otp_sent');
          toast.success('تم إرسال الكود إلى Telegram!');
        } else if (json.status === 'verified') {
          setStatus('verified');
          toast.success('تم التحقق من رقم هاتفك! جارٍ فتح صفحة التفعيل...');
          setTimeout(() => router.push('/'), 1500);
        } else if (json.status === 'expired') {
          setStatus('expired');
        }
      } catch {
        // silent — keep polling
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status, router]);

  // 4. Verify OTP
  const handleVerify = async () => {
    if (otpCode.length !== 6) { toast.error('أدخل كود من 6 أرقام'); return; }
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ code: otpCode.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setStatus('verified');
        toast.success('تم التحقق من رقم هاتفك بنجاح!');
        setTimeout(() => router.push('/'), 1000);
      } else {
        toast.error(json.error || 'الكود غير صحيح');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setVerifying(false);
    }
  };

  // 5. Resend (restart the verification flow)
  const handleResend = async () => {
    setOtpCode('');
    await init();
  };

  // 6. Update phone (when stored phone is wrong/missing)
  const handleSavePhone = async () => {
    const normalized = normalizePhoneToE164(newPhone.trim());
    if (!normalized) {
      toast.error('رقم الهاتف غير صالح. مثال: 01555614624 أو +201555614624');
      return;
    }
    setSavingPhone(true);
    try {
      // Re-call initiate with the new phone — it will normalize + persist
      // and create a new session in one step.
      const res = await fetch('/api/auth/initiate-telegram-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ phone: newPhone.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحديث رقمك وإنشاء جلسة جديدة.');
        setEditingPhone(false);
        setNewPhone('');
        setDeepLink(json.deep_link);
        setBotUsername(json.bot_username);
        setStatus('pending_start');
      } else {
        toast.error(json.error || 'تعذّر تحديث الرقم');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSavingPhone(false);
    }
  };

  const handleSignOut = () => {
    resetAppStore();
    try { signOut(); } catch {}
    router.push('/');
  };

  // Loading screen
  if (initiating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-teal-50">
        <div className="flex items-center gap-2 text-sky-700">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>جارٍ تجهيز جلسة التحقق...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-slate-50 to-teal-50 p-3 sm:p-6 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="border-0 shadow-2xl bg-white/95 dark:bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center pb-1 pt-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 shadow-lg"
            >
              <Send className="h-7 w-7 text-white" />
            </motion.div>
            <CardTitle className="text-xl font-bold">تأكيد رقم الهاتف</CardTitle>
            <CardDescription className="text-sm mt-1">
              {status === 'otp_sent'
                ? 'تم إرسال كود التحقق إلى Telegram.'
                : 'افتح Telegram واضغط Start لإرسال كود التحقق إليك.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 px-6 pb-6 space-y-4">
            {/* Phone info */}
            {phone && !editingPhone && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span dir="ltr">{phone}</span>
                <button
                  type="button"
                  onClick={() => { setEditingPhone(true); setNewPhone(phone || ''); }}
                  className="text-xs text-sky-600 hover:underline inline-flex items-center gap-1"
                  title="تعديل الرقم"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Phone edit form */}
            {editingPhone && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-900/15 p-3 space-y-2">
                <Label htmlFor="new-phone" className="text-xs font-medium">
                  أدخل الرقم الصحيح
                </Label>
                <Input
                  id="new-phone"
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="01000000000"
                  dir="ltr"
                  disabled={savingPhone}
                  className="text-sm h-10"
                  autoFocus
                />
                <div className="text-[10px] text-muted-foreground">
                  سيتم تحويله إلى: <span dir="ltr" className="font-mono">{normalizePhoneToE164(newPhone) || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSavePhone}
                    disabled={savingPhone || !newPhone.trim()}
                    className="h-8 text-xs"
                  >
                    {savingPhone ? (
                      <><Loader2 className="h-3 w-3 animate-spin me-1" />جارٍ الحفظ...</>
                    ) : (
                      'حفظ وإعادة الإرسال'
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setEditingPhone(false); setNewPhone(''); }}
                    disabled={savingPhone}
                    className="h-8 text-xs"
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 1: Open Telegram */}
            {status === 'pending_start' && deepLink && !editingPhone && (
              <div className="space-y-3">
                <div className="rounded-lg bg-sky-50 dark:bg-sky-900/15 border border-sky-200 dark:border-sky-900/60 p-3 text-sm text-sky-700 dark:text-sky-300 space-y-1">
                  <div className="font-semibold">الخطوة 1: افتح Telegram</div>
                  <div className="text-xs opacity-80">
                    اضغط الزر بالأسفل ليفتح محادثة البوت في Telegram. سيظهر زر Start في الأسفل — اضغطه لإرسال الكود إليك.
                  </div>
                </div>
                <a href={deepLink} target="_blank" rel="noopener noreferrer">
                  <Button
                    type="button"
                    className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700"
                  >
                    <Send className="h-5 w-5 me-2" /> فتح Telegram
                  </Button>
                </a>
                <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>في انتظار ضغطك لـ Start في Telegram...</span>
                </div>
              </div>
            )}

            {/* STEP 2: Enter OTP */}
            {status === 'otp_sent' && (
              <div className="space-y-3">
                <div className="rounded-lg bg-teal-50 dark:bg-teal-900/15 border border-teal-200 dark:border-teal-900/60 p-3 text-sm text-teal-700 dark:text-teal-300 space-y-1">
                  <div className="font-semibold">✅ تم إرسال الكود إلى Telegram</div>
                  <div className="text-xs opacity-80">أدخل الكود الذي وصلك في محادثة البوت.</div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="otp-input" className="text-sm font-medium text-center block">
                    أدخل كود التحقق (6 أرقام)
                  </Label>
                  <Input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="••••••"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="text-center text-2xl font-mono tracking-[0.5em] h-14"
                    disabled={verifying}
                    onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length === 6) handleVerify(); }}
                    autoFocus
                  />
                </div>
                <Button
                  onClick={handleVerify}
                  disabled={verifying || otpCode.length !== 6}
                  className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700"
                >
                  {verifying ? (
                    <><Loader2 className="h-5 w-5 animate-spin me-2" />جارٍ التحقق...</>
                  ) : (
                    <><CheckCircle2 className="h-5 w-5 me-2" />تأكيد الكود</>
                  )}
                </Button>
              </div>
            )}

            {/* Init error */}
            {status === 'init_error' && errorMessage && (
              <div className="rounded-lg bg-rose-50 dark:bg-rose-900/15 border border-rose-200 dark:border-rose-900/60 p-3 text-sm text-rose-700 dark:text-rose-400">
                {errorMessage}
              </div>
            )}

            {/* Expired */}
            {status === 'expired' && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-900/60 p-3 text-sm text-amber-700 dark:text-amber-400 space-y-2">
                <div className="font-semibold">انتهت صلاحية جلسة التحقق</div>
                <Button onClick={handleResend} size="sm" variant="outline">طلب كود جديد</Button>
              </div>
            )}

            {/* Verified — redirecting */}
            {status === 'verified' && (
              <div className="rounded-lg bg-teal-50 dark:bg-teal-900/15 border border-teal-200 dark:border-teal-900/60 p-3 text-sm text-teal-700 dark:text-teal-400 space-y-2 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                <div>تم التحقق بنجاح! جارٍ التحويل لصفحة التفعيل...</div>
              </div>
            )}

            {/* Footer: resend + logout */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleResend}
                disabled={cooldown > 0 || initiating}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium disabled:opacity-50 flex items-center gap-1"
              >
                {cooldown > 0 ? (
                  <><RefreshCw className="h-3 w-3" />إعادة ({cooldown}s)</>
                ) : (
                  <><RefreshCw className="h-3 w-3" />طلب كود جديد</>
                )}
              </button>
              <button
                onClick={handleSignOut}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <LogOut className="h-3 w-3" />تسجيل الخروج
              </button>
            </div>

            {/* Bot username footer */}
            {botUsername && (
              <p className="text-center text-xs text-muted-foreground">
                البوت: <span dir="ltr">@{botUsername}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
