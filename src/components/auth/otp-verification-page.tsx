'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, KeyRound, RefreshCw, LogOut, CheckCircle2, Phone, AlertTriangle } from 'lucide-react';
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

export default function OtpVerificationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut, user } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(true);
  const [gatewaySent, setGatewaySent] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayHttpStatus, setGatewayHttpStatus] = useState<number | null>(null);
  const [tokenConfigured, setTokenConfigured] = useState(true);
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [runningDiagnostic, setRunningDiagnostic] = useState(false);

  const phone = (user as { phone?: string } | null)?.phone ?? null;

  // Request OTP on mount.
  const init = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        setGatewaySent(json.gateway_sent ?? false);
        setGatewayError(json.gateway_error ?? null);
        setGatewayHttpStatus(json.gateway_http_status ?? null);
        setTokenConfigured(json.token_configured ?? true);
        if (json.gateway_sent) {
          toast.success(json.message || 'تم إرسال كود التحقق');
        } else {
          // Show a clear actionable error toast
          const err = json.gateway_error || (json.token_configured ? 'تعذّر إرسال الكود' : 'التوكن غير مُعدّ');
          toast.error(err, { duration: 8000 });
        }
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

  useEffect(() => { init(); }, [init]);

  // Cooldown timer.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Poll for verification result.
  // We use `phone_verified` (NOT `account_status`) as the signal —
  // because in the degraded state (v73 migration partially applied),
  // `account_status` stays 'pending' both before AND after the OTP
  // step. `phone_verified` flips from false → true on success, which
  // is unambiguous in both the v73 and degraded paths.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/me', { headers: await getCachedAuthHeaders() });
        const json = await res.json();
        if (json.profile?.phone_verified === true) {
          toast.success('تم التحقق من رقم هاتفك! جارٍ فتح صفحة التفعيل...');
          setTimeout(() => router.push('/'), 1500);
        }
      } catch { /* silent */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);

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
        toast.success('تم التحقق من رقم هاتفك بنجاح!');
        setTimeout(() => router.push('/'), 1000);
      } else {
        toast.error(json.error || 'الكود غير صحيح');
      }
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setVerifying(false); }
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
        setGatewaySent(json.gateway_sent ?? false);
        setGatewayError(json.gateway_error ?? null);
        setGatewayHttpStatus(json.gateway_http_status ?? null);
        setTokenConfigured(json.token_configured ?? true);
        if (json.gateway_sent) {
          toast.success(json.message || 'تم إعادة إرسال الكود');
        } else {
          toast.error(json.gateway_error || 'تعذّر إعادة الإرسال', { duration: 8000 });
        }
        setCooldown(60);
      } else {
        toast.error(json.error || 'تعذّر إعادة الإرسال');
      }
    } catch { toast.error(t('common.unexpectedError')); }
    finally { setResending(false); }
  };

  const handleRunDiagnostic = async () => {
    setRunningDiagnostic(true);
    setShowDiagnostic(true);
    try {
      const res = await fetch('/api/setup/check-telegram-gateway', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      setDiagnostic(json);
      if (json.verdict) {
        toast.info(json.verdict, { duration: 10000 });
      }
    } catch (e) {
      setDiagnostic({ error: e instanceof Error ? e.message : 'unknown' });
      toast.error('تعذّر تشغيل التشخيص');
    } finally {
      setRunningDiagnostic(false);
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
          <span>جارٍ إرسال كود التحقق...</span>
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
              تم إرسال كود التحقق إلى تطبيق تليجرام على رقمك.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 px-6 pb-6 space-y-4">
            {/* Phone info */}
            {phone && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span dir="ltr">{phone}</span>
                {!gatewaySent && tokenConfigured && (
                  <Badge variant="destructive" className="text-xs">تعذّر الإرسال</Badge>
                )}
                {!tokenConfigured && (
                  <Badge variant="secondary" className="text-xs">التوكن غير مُعدّ</Badge>
                )}
              </div>
            )}

            {/* Gateway error banner */}
            {!gatewaySent && gatewayError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/15 p-3 space-y-2">
                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs space-y-1">
                    <div className="font-semibold">لم يتم إرسال الكود إلى تليجرام</div>
                    <div className="opacity-80">
                      {gatewayError}
                      {gatewayHttpStatus && ` (HTTP ${gatewayHttpStatus})`}
                    </div>
                    <button
                      type="button"
                      onClick={handleRunDiagnostic}
                      disabled={runningDiagnostic}
                      className="mt-1 underline hover:no-underline disabled:opacity-50"
                    >
                      {runningDiagnostic ? 'جارٍ التشخيص...' : 'تشخيص المشكلة'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Diagnostic panel */}
            {showDiagnostic && diagnostic && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-900/15 p-3 text-xs space-y-1">
                <div className="font-semibold mb-1">نتائج التشخيص:</div>
                {diagnostic.verdict && (
                  <div className="text-sky-700 dark:text-sky-300">{diagnostic.verdict as string}</div>
                )}
                <div className="font-mono text-[10px] text-muted-foreground mt-2 max-h-32 overflow-auto">
                  <pre dir="ltr">{JSON.stringify(diagnostic, null, 2)}</pre>
                </div>
              </div>
            )}

            {/* OTP input */}
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

            {/* Resend + sign out */}
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

            {/* Help text */}
            <p className="text-center text-xs text-muted-foreground">
              إذا لم تصلك رسالة التحقق، تأكد من أن تليجرام مثبت على هاتفك ومسجّل بنفس الرقم.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
