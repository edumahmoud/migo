'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Lock, Loader2, CheckCircle2, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

// ─── Supabase client (local to this page, independent of main app) ───
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/** Password strength evaluator — returns 0–3 */
function getPasswordStrength(password: string): number {
  let score = 0;
  if (password.length >= 6) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 3);
}

const strengthLabels = ['ضعيفة', 'متوسطة', 'قوية'];
const strengthColors = ['bg-rose-500', 'bg-amber-500', 'bg-emerald-500'];
const strengthTextColors = ['text-rose-600', 'text-amber-600', 'text-emerald-600'];

type PageState = 'loading' | 'invalid' | 'form' | 'success' | 'error';

export default function ResetPasswordPage() {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Step 1: Exchange code / validate session ───
  useEffect(() => {
    const init = async () => {
      if (!supabaseUrl || !supabaseAnonKey) {
        setErrorMessage('خطأ في إعدادات الخادم');
        setPageState('error');
        return;
      }

      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
        auth: { detectSessionInUrl: false },
      });

      try {
        // ─── FIRST: Check if a session already exists (e.g. auto-detect from another client) ───
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession?.user) {
          console.log('[ResetPassword] Existing session found — showing form');
          setPageState('form');
          return;
        }

        // ─── SECOND: Try PKCE code exchange if ?code= is in the URL ───
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code) {
          // PKCE flow: exchange code for session
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error('[ResetPassword] Code exchange error:', exchangeError.message);
            // ─── THIRD: Check session again — auto-detect might have succeeded elsewhere ───
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession?.user) {
              console.log('[ResetPassword] Session found after exchange error — showing form');
              setPageState('form');
              return;
            }
            setErrorMessage('رابط إعادة التعيين غير صالح أو منتهي الصلاحية');
            setPageState('invalid');
            return;
          }
          // Clean URL
          window.history.replaceState({}, '', window.location.pathname);
        }

        // ─── FINAL: Verify we have a valid session ───
        const { data: { session: finalSession } } = await supabase.auth.getSession();

        if (!finalSession?.user) {
          setErrorMessage('رابط إعادة التعيين غير صالح أو منتهي الصلاحية');
          setPageState('invalid');
          return;
        }

        // Valid session — show the update form
        setPageState('form');
      } catch (err) {
        console.error('[ResetPassword] Init error:', err);
        setErrorMessage('حدث خطأ غير متوقع');
        setPageState('error');
      }
    };

    init();
  }, []);

  // ─── Step 2: Submit new password ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      setErrorMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('كلمتا المرور غير متطابقتين');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
        auth: { detectSessionInUrl: false },
      });

      // ── Verify session is still valid before updating password ──
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.user) {
        setErrorMessage('انتهت صلاحية الجلسة. يرجى فتح رابط إعادة التعيين مرة أخرى من البريد الإلكتروني');
        setIsSubmitting(false);
        return;
      }

      // ── Call updateUser with timeout (15s) ──
      const updatePromise = supabase.auth.updateUser({ password: newPassword });
      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى' } }), 15_000)
      );

      const { error } = await Promise.race([updatePromise, timeoutPromise]);

      if (error) {
        console.error('[ResetPassword] Update password error:', error.message, 'Status:', error.status, 'Code:', (error as any).code);
        const msg = error.message?.toLowerCase() || '';

        if (msg.includes('same') || msg.includes('different')) {
          setErrorMessage('كلمة المرور الجديدة يجب أن تكون مختلفة عن كلمة المرور الحالية');
        } else if (msg.includes('session') || msg.includes('auth') || msg.includes('unauthenticated')) {
          setErrorMessage('انتهت صلاحية الجلسة. يرجى فتح رابط إعادة التعيين مرة أخرى من البريد الإلكتروني');
        } else if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
          setErrorMessage('طلبات كثيرة جداً. يرجى الانتظار ثم المحاولة مرة أخرى');
        } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('require') || msg.includes('strength') || msg.includes('policy') || msg.includes('validation'))) {
          setErrorMessage('كلمة المرور لا تلبي متطلبات الأمان. تأكد من أن كلمة المرور تحتوي على أحرف كبيرة وصغيرة وأرقام');
        } else {
          // Show the actual error from Supabase with a fallback
          setErrorMessage(error.message || 'حدث خطأ أثناء تحديث كلمة المرور. يرجى المحاولة مرة أخرى');
        }
        setIsSubmitting(false);
        return;
      }

      setPageState('success');

      // Sign out and redirect to main app after a short delay
      setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = '/';
      }, 2500);
    } catch (err) {
      console.error('[ResetPassword] Unexpected error:', err);
      setErrorMessage('حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى');
      setIsSubmitting(false);
    }
  };

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const mismatch = confirmPassword && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= 6 && passwordsMatch && !isSubmitting;

  // ─── Render ───
  return (
    <div
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 via-white to-sky-50/30 px-4 py-8"
    >
      <div className="w-full max-w-md">
        {/* ── Loading ── */}
        {pageState === 'loading' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center gap-4 py-16"
          >
            <Loader2 className="h-10 w-10 animate-spin text-sky-600" />
            <p className="text-sm text-gray-500">جارٍ التحقق من الرابط...</p>
          </motion.div>
        )}

        {/* ── Invalid / Expired Link ── */}
        {(pageState === 'invalid' || pageState === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl border-0 overflow-hidden">
              <div className="flex flex-col items-center py-10 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 mb-4">
                  <ShieldCheck className="h-8 w-8 text-rose-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {pageState === 'invalid' ? 'الرابط غير صالح أو منتهي' : 'حدث خطأ'}
                </h2>
                <p className="text-sm text-gray-500 mb-6">
                  {errorMessage || 'رابط إعادة تعيين كلمة المرور غير صالح أو انتهت صلاحيته. يرجى طلب رابط جديد.'}
                </p>
                <a
                  href="/"
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 text-white font-semibold text-base shadow-lg shadow-sky-500/25 hover:from-sky-800 hover:to-teal-700 transition-all"
                >
                  <ArrowRight className="h-4 w-4" />
                  العودة لتسجيل الدخول
                </a>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Success ── */}
        {pageState === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl border-0 overflow-hidden">
              <div className="flex flex-col items-center py-10 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
                  <CheckCircle2 className="h-9 w-9 text-emerald-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">تم تحديث كلمة المرور</h2>
                <p className="text-sm text-gray-500">سيتم تحويلك لصفحة تسجيل الدخول...</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Update Password Form ── */}
        {pageState === 'form' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="bg-white rounded-2xl shadow-2xl border-0 overflow-hidden">
              {/* Header */}
              <div className="text-center pt-6 pb-2 px-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100">
                  <Lock className="h-6 w-6 text-sky-600" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  تعيين كلمة مرور جديدة
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  أدخل كلمة المرور الجديدة لحسابك
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-4">
                {/* Error message */}
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 text-center"
                  >
                    {errorMessage}
                  </motion.div>
                )}

                {/* New Password */}
                <div className="space-y-2">
                  <label htmlFor="new-password" className="text-gray-700 font-medium text-sm">
                    كلمة المرور الجديدة
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="أدخل كلمة المرور الجديدة"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pr-4 pl-10 h-11 rounded-xl bg-gray-50/50 border border-gray-200 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none text-right transition-colors"
                      disabled={isSubmitting}
                      dir="ltr"
                      maxLength={128}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Password strength */}
                  {newPassword.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex gap-1">
                        {[0, 1, 2].map((level) => (
                          <div
                            key={level}
                            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                              strength > level ? strengthColors[strength - 1] : 'bg-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                      <p className={`text-xs font-medium ${strengthTextColors[strength - 1] || 'text-gray-400'}`}>
                        {strength > 0 ? strengthLabels[strength - 1] : 'ضعيفة جداً'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-gray-700 font-medium text-sm">
                    تأكيد كلمة المرور
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="أعد إدخال كلمة المرور"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`w-full pr-4 pl-10 h-11 rounded-xl bg-gray-50/50 outline-none text-right transition-colors ${
                        mismatch ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
                        : passwordsMatch ? 'border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
                        : 'border-gray-200 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20'
                      }`}
                      disabled={isSubmitting}
                      dir="ltr"
                      maxLength={128}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mismatch && (
                    <p className="text-xs text-rose-500 font-medium">كلمتا المرور غير متطابقتين</p>
                  )}
                  {passwordsMatch && (
                    <p className="text-xs text-emerald-500 font-medium">كلمتا المرور متطابقتان ✓</p>
                  )}
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full h-11 rounded-xl text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 text-white shadow-lg shadow-sky-500/25 hover:from-sky-800 hover:to-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>جارٍ التحديث...</span>
                    </>
                  ) : (
                    'تحديث كلمة المرور'
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
