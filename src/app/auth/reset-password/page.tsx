'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Lock, Loader2, CheckCircle2, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from '@/i18n/use-translations';

// ─── Supabase config ───
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

  const { t, isRTL, direction } = useTranslations();

  // ── CRITICAL: Store the Supabase client instance so we reuse it ──
  // Previously, handleSubmit created a NEW client each time, which lost the
  // session that was established in init(). This was the root cause of
  // "حدث خطأ أثناء تحديث كلمة المرور" — the new client had no session.
  const supabaseRef = useRef<SupabaseClient | null>(null);

  // ─── Step 1: Exchange code / validate session ───
  useEffect(() => {
    const init = async () => {
      if (!supabaseUrl || !supabaseAnonKey) {
        setErrorMessage(t('common.serverError'));
        setPageState('error');
        return;
      }

      // Create ONE client and store it for reuse
      const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
        auth: { detectSessionInUrl: false },
      });
      supabaseRef.current = supabase;

      try {
        // ─── FIRST: Check if a session already exists ───
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession?.user) {
          console.log('[ResetPassword] Existing session found — showing form');
          setPageState('form');
          return;
        }

        // ─── SECOND: Try PKCE code exchange ───
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (code) {
          console.log('[ResetPassword] PKCE code found — exchanging for session');
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error('[ResetPassword] Code exchange error:', exchangeError.message);
            // Check session again — might have been set by another tab/client
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession?.user) {
              console.log('[ResetPassword] Session found after exchange error — showing form');
              setPageState('form');
              return;
            }
            setErrorMessage(t('auth.invalidOrExpiredLink'));
            setPageState('invalid');
            return;
          }
          // Clean URL
          window.history.replaceState({}, '', window.location.pathname);
        }

        // ─── FINAL: Verify we have a valid session ───
        const { data: { session: finalSession } } = await supabase.auth.getSession();

        if (!finalSession?.user) {
          setErrorMessage(t('auth.invalidOrExpiredLink'));
          setPageState('invalid');
          return;
        }

        console.log('[ResetPassword] Valid session — showing form');
        setPageState('form');
      } catch (err) {
        console.error('[ResetPassword] Init error:', err);
        setErrorMessage(t('common.unexpectedError'));
        setPageState('error');
      }
    };

    init();
  }, [t]);

  // ─── Step 2: Submit new password ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      setErrorMessage(t('auth.passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage(t('auth.passwordsDontMatch'));
      return;
    }

    const supabase = supabaseRef.current;
    if (!supabase) {
      setErrorMessage(t('common.connectionError'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      // ── Verify session is still valid ──
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('[ResetPassword] getSession error:', sessionError.message);
      }

      if (!currentSession?.user) {
        setErrorMessage(t('auth.expiredSession'));
        setIsSubmitting(false);
        return;
      }

      console.log('[ResetPassword] Updating password for user:', currentSession.user.email);

      // ── Call updateUser ──
      const result = await supabase.auth.updateUser({ password: newPassword });
      const error = result.error;

      if (error) {
        // Log FULL error details for debugging
        console.error('[ResetPassword] Update password FAILED:', {
          message: error.message,
          name: error.name,
          status: (error as any).status,
          code: (error as any).code,
          statusText: (error as any).statusText,
        });

        const msg = error.message?.toLowerCase() || '';

        if (msg.includes('same') || msg.includes('different') || msg.includes('old password')) {
          setErrorMessage(t('auth.passwordDifferent'));
        } else if (msg.includes('session') || msg.includes('unauthenticated') || msg.includes('not found') || msg.includes('jwt') || msg.includes('token')) {
          setErrorMessage(t('auth.expiredSession'));
        } else if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
          setErrorMessage(t('common.tooManyRequests'));
        } else if (msg.includes('password') || msg.includes('weak') || msg.includes('require') || msg.includes('strength') || msg.includes('policy') || msg.includes('validation') || msg.includes('criteria')) {
          setErrorMessage(t('auth.passwordNotMeetRequirements'));
        } else {
          // Show the ACTUAL Supabase error message — no more hiding it!
          setErrorMessage(t('auth.errorWithMessage', { message: error.message }));
        }
        setIsSubmitting(false);
        return;
      }

      console.log('[ResetPassword] Password updated successfully');
      setPageState('success');

      // Sign out and redirect after delay
      setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = '/';
      }, 2500);
    } catch (err: any) {
      console.error('[ResetPassword] Unexpected error:', err);
      setErrorMessage(t('auth.unexpectedAuthError', { message: err?.message || t('auth.fallbackError') }));
      setIsSubmitting(false);
    }
  };

  const strength = getPasswordStrength(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const mismatch = confirmPassword && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= 6 && passwordsMatch && !isSubmitting;

  const getStrengthLabel = (s: number) => {
    if (s <= 0) return t('auth.passwordStrength.veryWeak');
    if (s === 1) return t('auth.passwordStrength.weak');
    if (s === 2) return t('auth.passwordStrength.fair');
    return t('auth.passwordStrength.strong');
  };

  // ─── Render ───
  return (
    <div
      dir={direction}
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
            <p className="text-sm text-gray-500">{t('auth.verifyingLink')}</p>
          </motion.div>
        )}

        {/* ── Invalid / Expired Link ── */}
        {(pageState === 'invalid' || pageState === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="bg-white dark:bg-card rounded-2xl shadow-2xl border-0 overflow-hidden">
              <div className="flex flex-col items-center py-10 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30 mb-4">
                  <ShieldCheck className="h-8 w-8 text-rose-600 dark:text-rose-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">
                  {pageState === 'invalid' ? t('auth.invalidOrExpiredLink') : t('auth.errorOccurred')}
                </h2>
                <p className="text-sm text-gray-500 mb-6">
                  {errorMessage || t('auth.invalidResetLinkDescFull')}
                </p>
                <a
                  href="/"
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 text-white font-semibold text-base shadow-lg shadow-sky-500/25 hover:from-sky-800 hover:to-teal-700 transition-all"
                >
                  <ArrowRight className="h-4 w-4" />
                  {t('common.returnToLogin')}
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
            <div className="bg-white dark:bg-card rounded-2xl shadow-2xl border-0 overflow-hidden">
              <div className="flex flex-col items-center py-10 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/15 mb-4">
                  <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">{t('auth.passwordUpdated')}</h2>
                <p className="text-sm text-gray-500">{t('auth.passwordUpdatedDesc')}</p>
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
            <div className="bg-white dark:bg-card rounded-2xl shadow-2xl border-0 overflow-hidden">
              {/* Header */}
              <div className="text-center pt-6 pb-2 px-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100">
                  <Lock className="h-6 w-6 text-sky-600" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {t('auth.setNewPassword')}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {t('auth.setNewPasswordDesc')}
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
                    {t('auth.newPassword')}
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={t('auth.enterNewPassword')}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pe-4 ps-10 h-11 rounded-xl bg-gray-50/50 dark:bg-input/50 border border-gray-200 dark:border-border focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 outline-none text-end transition-colors"
                      disabled={isSubmitting}
                      dir="ltr"
                      maxLength={128}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground"
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
                              strength > level ? strengthColors[strength - 1] : 'bg-gray-200 dark:bg-gray-800'
                            }`}
                          />
                        ))}
                      </div>
                      <p className={`text-xs font-medium ${strengthTextColors[strength - 1] || 'text-gray-400'}`}>
                        {getStrengthLabel(strength)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <label htmlFor="confirm-password" className="text-gray-700 font-medium text-sm">
                    {t('auth.confirmPassword')}
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder={t('auth.reenterPassword')}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`w-full pe-4 ps-10 h-11 rounded-xl bg-gray-50/50 dark:bg-input/50 outline-none text-end transition-colors ${
                        mismatch ? 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20'
                        : passwordsMatch ? 'border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20'
                        : 'border-gray-200 dark:border-border focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20'
                      }`}
                      disabled={isSubmitting}
                      dir="ltr"
                      maxLength={128}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mismatch && (
                    <p className="text-xs text-rose-500 font-medium">{t('auth.passwordsDontMatch')}</p>
                  )}
                  {passwordsMatch && (
                    <p className="text-xs text-emerald-500 font-medium">{t('auth.passwordsMatch')}</p>
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
                      <span>{t('auth.updating')}</span>
                    </>
                  ) : (
                    t('auth.updatePassword')
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
