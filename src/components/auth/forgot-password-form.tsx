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
 * Wrap a promise with a timeout.
 * Returns { data, error } just like Supabase — avoids throwing on timeout.
 * This is the KEY FIX: without a timeout, if the Supabase API is slow/unreachable,
 * the Promise never settles and the spinner stays forever.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ data: T | null; error: { message: string; status?: number; code?: string } | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ data: null, error: { message: `انتهت مهلة الطلب (${Math.round(ms / 1000)} ثانية). يرجى المحاولة مرة أخرى` } });
    }, ms);

    promise
      .then((data) => {
        clearTimeout(timer);
        resolve({ data, error: null });
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
      toast.error('يرجى إدخال البريد الإلكتروني');
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
      // Without timeout, if the API hangs the spinner stays forever.
      const { data, error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }),
        REQUEST_TIMEOUT_MS,
      );

      if (error) {
        console.error('[ForgotPassword] Error:', error.message, 'Status:', error.status);

        const msg = error.message?.toLowerCase() || '';
        const status = error.status;
        const errorCode = error.code;

        if (status === 429 || msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
          // Rate limit hit — start cooldown so the user doesn't retry too quickly
          setLastSentTime(Date.now());
          setCooldownRemaining(COOLDOWN_SECONDS);
          toast.error('تم تجاوز حد عدد الرسائل. يرجى الانتظار قبل المحاولة مرة أخرى');
        } else if (msg.includes('انتهت مهلة') || msg.includes('timeout')) {
          toast.error('انتهت مهلة الاتصال بالخادم. يرجى التحقق من الإنترنت والمحاولة مرة أخرى');
        } else if (msg.includes('email not found') || msg.includes('user not found')) {
          // Don't reveal whether the email exists (security best practice)
          setEmailSent(true);
        } else if (
          msg.includes('redirect') || msg.includes('url not allowed') ||
          msg.includes('invalid redirect') || msg.includes('not allowed') ||
          errorCode === 'url_not_allowed' || status === 403
        ) {
          toast.error('خطأ في إعدادات رابط إعادة التعيين. يرجى التواصل مع المشرف');
          console.error('[ForgotPassword] Redirect URL not allowed! Add to Supabase Dashboard > Authentication > URL Configuration > Redirect URLs:', `${window.location.origin}/auth/reset-password`);
        } else {
          toast.error('حدث خطأ أثناء إرسال رابط إعادة التعيين');
          console.error('[ForgotPassword] Unhandled error:', error.message);
        }
        return;
      }

      // ── Success ──
      setLastSentTime(Date.now());
      setCooldownRemaining(COOLDOWN_SECONDS);
      setEmailSent(true);
      toast.success('تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني');
    } catch (err) {
      console.error('[ForgotPassword] Unexpected error:', err);
      toast.error('حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى');
    } finally {
      setIsLoading(false);
    }
  };

  const canResend = cooldownRemaining === 0 && !isLoading;

  return (
    <div dir="rtl" className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              استعادة كلمة المرور
            </CardTitle>
            <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
              {emailSent
                ? 'تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني'
                : 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين'
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
                  العودة لتسجيل الدخول
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
                    البريد الإلكتروني
                  </Label>
                  <div className="relative">
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="أدخل بريدك الإلكتروني المسجل"
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
                        <span>جارٍ الإرسال...</span>
                      </>
                    ) : cooldownRemaining > 0 ? (
                      <>
                        <Clock className="h-4 w-4 ml-1" />
                        انتظر {formatCooldown(cooldownRemaining)}
                      </>
                    ) : (
                      'إرسال رابط إعادة التعيين'
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
                    العودة لتسجيل الدخول
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
