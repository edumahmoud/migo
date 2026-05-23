'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { useTranslation, useI18n } from '@/lib/i18n/context';

// ─── Constants ───
const REQUEST_TIMEOUT_MS = 15_000; // 15 seconds timeout for the API call
const COOLDOWN_SECONDS = 60; // Cooldown between reset emails (Supabase free plan = 2 emails/hour)
const STORAGE_KEY = 'attendo_reset_pwd_last_sent';

// ─── Helpers ───
function getLastSentTime(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function setLastSentTime(ts: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch { /* ignore */ }
}

/** Basic email format check — avoids sending obviously invalid emails to the API */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Wrap a Supabase promise with a timeout.
 *
 * CRITICAL: Supabase clients resolve with { data, error } even on failure —
 * they don't throw. The previous version of this wrapper only checked for
 * thrown errors, which meant Supabase errors were silently swallowed and
 * the success branch ran (showing a false "email sent" message).
 *
 * Now: extracts the inner `error` from the Supabase response so the caller
 * can check a single `error` variable for both timeout/connection errors
 * AND Supabase-returned errors.
 */
function withSupabaseTimeout<Res extends { data: unknown; error: { message: string; status?: number; code?: string } | null }>(
  promise: Promise<Res>,
  ms: number,
): Promise<{ data: Res['data'] | null; error: { message: string; status?: number; code?: string } | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ data: null, error: { message: `انتهت مهلة الطلب (${Math.round(ms / 1000)} ثانية). يرجى المحاولة مرة أخرى` } });
    }, ms);

    promise
      .then((res) => {
        clearTimeout(timer);
        // Forward Supabase errors so the caller sees them in `error`
        if (res.error) {
          resolve({ data: null, error: { message: res.error.message, status: res.error.status, code: (res.error as any).code } });
        } else {
          resolve({ data: res.data, error: null });
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve({ data: null, error: { message: err?.message || 'حدث خطأ في الاتصال', status: err?.status, code: err?.code } });
      });
  });
}

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export default function ForgotPasswordForm({ onBackToLogin }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const { t } = useTranslation();
  const { dir } = useI18n();

  // ─── Cooldown timer ───
  // Prevents the user from sending another reset email until the cooldown expires.
  // This protects against Supabase's 2 emails/hour limit.
  useEffect(() => {
    const lastSent = getLastSentTime();
    const elapsed = Math.floor((Date.now() - lastSent) / 1000);
    const remaining = Math.max(0, COOLDOWN_SECONDS - elapsed);

    if (remaining > 0) {
      setCooldownRemaining(remaining);
    }

    const interval = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatCooldown = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`;
    return `${s} ثانية`;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Pre-flight checks ──
    if (!email.trim()) {
      toast.error(t('auth.forgotPassword.errorEmailRequired'));
      return;
    }
    if (!isValidEmail(email)) {
      toast.error('صيغة البريد الإلكتروني غير صحيحة');
      return;
    }
    if (cooldownRemaining > 0) {
      toast.error(`يرجى الانتظار ${formatCooldown(cooldownRemaining)} قبل المحاولة مرة أخرى`);
      return;
    }
    if (!isSupabaseConfigured) {
      toast.error('خطأ في إعدادات الخادم — يرجى التواصل مع الدعم');
      console.error('[ForgotPassword] Supabase is not configured — NEXT_PUBLIC_SUPABASE_URL or ANON_KEY is missing');
      return;
    }

    setIsLoading(true);
    try {
      // ── Call Supabase with a timeout wrapper ──
      // The wrapper extracts both thrown errors and Supabase-returned errors
      // into a single `error` field so we never miss a failure.
      const { error } = await withSupabaseTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }),
        REQUEST_TIMEOUT_MS,
      );

      if (error) {
        console.error('[ForgotPassword] Error:', error.message, 'Status:', error.status, 'Code:', error.code);

        const msg = error.message?.toLowerCase() || '';
        const status = error.status;
        const errorCode = error.code;

        if (status === 429 || msg.includes('rate limit') || msg.includes('too many') || msg.includes('429') || msg.includes('email rate limit exceeded')) {
          // Rate limit hit — start cooldown so the user doesn't retry too quickly
          setLastSentTime(Date.now());
          setCooldownRemaining(COOLDOWN_SECONDS);
          toast.error('تم تجاوز حد عدد الرسائل. يرجى الانتظار قبل المحاولة مرة أخرى');
        } else if (msg.includes('انتهت مهلة') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
          toast.error('انتهت مهلة الاتصال بالخادم. يرجى التحقق من الإنترنت والمحاولة مرة أخرى');
        } else if (
          msg.includes('email not found') || msg.includes('user not found') ||
          msg.includes('no user found')
        ) {
          // Don't reveal whether the email exists (security best practice)
          setEmailSent(true);
        } else if (
          msg.includes('redirect') || msg.includes('url not allowed') ||
          msg.includes('invalid redirect') || msg.includes('not allowed') ||
          errorCode === 'url_not_allowed' || status === 403 ||
          msg.includes('requested url is not allowed')
        ) {
          toast.error('خطأ في إعدادات رابط إعادة التعيين. يرجى التواصل مع المشرف');
          console.error('[ForgotPassword] Redirect URL not allowed! Add to Supabase Dashboard > Authentication > URL Configuration > Redirect URLs:', `${window.location.origin}/auth/reset-password`);
        } else if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('net::')) {
          toast.error('فشل الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى');
        } else if (msg.includes('invalid api key') || msg.includes('invalid api') || status === 401) {
          toast.error('خطأ في إعدادات الخادم. يرجى التواصل مع الدعم الفني');
          console.error('[ForgotPassword] API key issue — check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
        } else {
          // Show the actual error message so the user can report it —
          // a generic message makes debugging impossible.
          const displayMsg = error.message?.length > 100
            ? error.message.substring(0, 100) + '...'
            : error.message;
          toast.error(`خطأ: ${displayMsg}`);
          console.error('[ForgotPassword] Unhandled error — full details:', JSON.stringify(error));
        }
        return;
      }

      // ── Success ──
      setLastSentTime(Date.now());
      setCooldownRemaining(COOLDOWN_SECONDS);
      setEmailSent(true);
      toast.success(t('auth.forgotPassword.successSent'));
    } catch (err) {
      console.error('[ForgotPassword] Unexpected error:', err);
      toast.error(t('auth.forgotPassword.errorUnexpected'));
    } finally {
      setIsLoading(false);
    }
  };

  const canResend = cooldownRemaining === 0 && !isLoading;

  return (
    <div dir={dir} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              {t('auth.forgotPassword.title')}
            </CardTitle>
            <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
              {emailSent
                ? t('auth.forgotPassword.successSent')
                : t('auth.forgotPassword.subtitle')
              }
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 sm:pt-4 px-4 sm:px-6 pb-4 sm:pb-6">
            {emailSent ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-3 sm:space-y-4"
              >
                <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-sky-100 mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-sky-600" />
                </div>
                <p className="text-sm text-gray-600">
                  تم إرسال رابط إعادة تعيين كلمة المرور إلى <span className="font-semibold">{email}</span>
                </p>
                <p className="text-xs text-gray-400">
                  يرجى التحقق من صندوق الوارد والبريد غير المرغوب فيه
                </p>

                {/* Resend button with cooldown */}
                {cooldownRemaining > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg py-2 px-3">
                      <Clock className="h-3.5 w-3.5" />
                      <span>يمكنك إعادة الإرسال بعد {formatCooldown(cooldownRemaining)}</span>
                    </div>
                    <Button
                      type="button"
                      onClick={() => {
                        setEmailSent(false);
                      }}
                      variant="outline"
                      disabled
                      className="w-full h-10 text-sm font-medium border-gray-200 opacity-50"
                    >
                      <Clock className="h-4 w-4 ml-1" />
                      إعادة الإرسال ({formatCooldown(cooldownRemaining)})
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      setEmailSent(false);
                    }}
                    variant="outline"
                    className="w-full h-10 text-sm font-medium border-gray-200 hover:bg-gray-50"
                  >
                    إعادة إرسال الرابط
                  </Button>
                )}

                <Button
                  type="button"
                  onClick={onBackToLogin}
                  variant="outline"
                  className="w-full h-11 text-base font-medium border-gray-200 hover:bg-gray-50"
                >
                  {t('auth.forgotPassword.backToLogin')}
                </Button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-5">
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                  className="space-y-2"
                >
                  <Label htmlFor="reset-email" className="text-gray-700 font-medium text-xs sm:text-sm">
                    {t('auth.forgotPassword.emailLabel')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder={t('auth.forgotPassword.emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pr-10 h-10 sm:h-11 bg-gray-50/50 border-gray-200 focus:border-sky-500 focus:ring-sky-500/20 text-right"
                      disabled={isLoading || cooldownRemaining > 0}
                      dir="ltr"
                      maxLength={254}
                    />
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  </div>
                </motion.div>

                {/* Cooldown notice on the form */}
                {cooldownRemaining > 0 && (
                  <div className="flex items-center justify-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg py-2 px-3">
                    <Clock className="h-3.5 w-3.5" />
                    <span>يرجى الانتظار {formatCooldown(cooldownRemaining)} قبل إرسال رابط جديد</span>
                  </div>
                )}

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <Button
                    type="submit"
                    disabled={!canResend}
                    className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700 shadow-lg shadow-sky-500/25 transition-all duration-300 disabled:opacity-50"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>{t('auth.forgotPassword.sending')}</span>
                      </>
                    ) : cooldownRemaining > 0 ? (
                      <>
                        <Clock className="h-4 w-4 ml-1" />
                        انتظر {formatCooldown(cooldownRemaining)}
                      </>
                    ) : (
                      t('auth.forgotPassword.submit')
                    )}
                  </Button>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-center"
                >
                  <button
                    type="button"
                    onClick={onBackToLogin}
                    className="text-sm text-sky-600 hover:text-sky-700 font-medium transition-colors inline-flex items-center gap-1"
                  >
                    <ArrowRight className="h-4 w-4" />
                    {t('auth.forgotPassword.backToLogin')}
                  </button>
                </motion.div>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
