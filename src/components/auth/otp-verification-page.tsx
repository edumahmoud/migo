'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, KeyRound, RefreshCw, LogOut, CheckCircle2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';

const TELEGRAM_BOT_NAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME || 'AttenDoBot';

export default function OtpVerificationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut, user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch the user's phone + request initial OTP.
  const init = useCallback(async () => {
    setLoading(true);
    try {
      // Request an OTP to be sent via Telegram.
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إرسال كود التحقق');
        setCooldown(60);
      } else {
        toast.error(json.error || 'تعذّر إرسال الكود');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Set the phone from the user profile.
    const p = (user as { phone?: string } | null)?.phone ?? null;
    setPhone(p);
    init();
  }, [init, user]);

  // Cooldown timer.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Poll for account status changes (when OTP verified on another device).
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch('/api/auth/me', { headers: await getCachedAuthHeaders() });
      const json = await res.json();
      if (json.profile?.account_status === 'pending') {
        toast.success('تم التحقق من رقم هاتفك! جارٍ فتح صفحة التفعيل...');
        setTimeout(() => router.push('/'), 1500);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

  const handleVerify = async () => {
    if (otpCode.length !== 6) {
      toast.error('أدخل كود من 6 أرقام');
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ code: otpCode.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم التحقق من رقم هاتفك بنجاح!');
        // Refresh the auth store to get the updated account_status.
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

  const handleResend = async () => {
    setResending(true);
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || 'تم إعادة إرسال الكود');
        setCooldown(60);
      } else {
        toast.error(json.error || 'تعذّر إعادة الإرسال');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = () => {
    resetAppStore();
    try { signOut(); } catch {}
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 to-teal-50">
        <div className="flex items-center gap-2 text-sky-700">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>جارٍ تحميل صفحة التحقق...</span>
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
              <KeyRound className="h-7 w-7 text-white" />
            </motion.div>
            <CardTitle className="text-xl font-bold">تأكيد رقم الهاتف</CardTitle>
            <CardDescription className="text-sm mt-1">
              تم إنشاء حسابك. للتحقق من رقم هاتفك، اتبع الخطوات التالية.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 px-6 pb-6 space-y-4">
            {/* Telegram instructions */}
            <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sky-800 font-semibold text-sm">
                <MessageCircle className="h-4 w-4" />
                الخطوة 1: افتح تليجرام
              </div>
              <p className="text-xs text-sky-700">
                افتح تليجرام وابدأ محادثة مع البوت{' '}
                <a
                  href={`https://t.me/${TELEGRAM_BOT_NAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline"
                >
                  @{TELEGRAM_BOT_NAME}
                </a>
                {' '}ثم اضغط زر "مشاركة رقم الهاتف".
              </p>
              {phone && (
                <Badge variant="outline" className="text-xs" dir="ltr">{phone}</Badge>
              )}
            </div>

            {/* OTP input */}
            <div className="space-y-2">
              <Label htmlFor="otp-input" className="text-sm font-medium">
                الخطوة 2: أدخل كود التحقق (6 أرقام)
              </Label>
              <Input
                id="otp-input"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center text-2xl font-mono tracking-[0.5em] h-14"
                disabled={verifying}
                onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length === 6) handleVerify(); }}
              />
            </div>

            {/* Verify button */}
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

            {/* Resend button */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleResend}
                disabled={resending || cooldown > 0}
                className="text-xs text-sky-600 hover:text-sky-700 font-medium disabled:opacity-50 flex items-center gap-1"
              >
                {resending ? (
                  <><Loader2 className="h-3 w-3 animate-spin" />جارٍ الإرسال...</>
                ) : cooldown > 0 ? (
                  <><RefreshCw className="h-3 w-3" />إعادة الإرسال ({cooldown}s)</>
                ) : (
                  <><RefreshCw className="h-3 w-3" />إعادة إرسال الكود</>
                )}
              </button>
              <button
                onClick={handleSignOut}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <LogOut className="h-3 w-3" />تسجيل الخروج
              </button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
