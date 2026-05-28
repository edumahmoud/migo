'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, Loader2, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';

interface UpdatePasswordFormProps {
  onSuccess: () => void;
}

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

export default function UpdatePasswordForm({ onSuccess }: UpdatePasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [isValidRecovery, setIsValidRecovery] = useState(false);
  const { t, direction, isRTL } = useTranslations();

  // Verify that we have a valid recovery session
  useEffect(() => {
    const verifyRecovery = async () => {
      try {
        // ─── FIRST: Check if a session already exists ───
        // The auto-detect might have already exchanged the code.
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession?.user) {
          setIsValidRecovery(true);
          setVerifying(false);
          return;
        }

        // ─── SECOND: Try PKCE code exchange if ?code=xxx is in the URL ───
        // This handles the case where the user lands on the main page
        // with a PKCE code (instead of the dedicated /auth/reset-password page).
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code) {
          console.log('[UpdatePasswordForm] PKCE code detected — exchanging for session');
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error('[UpdatePasswordForm] Code exchange error:', exchangeError.message);
            // ─── THIRD: Check session again — auto-detect might have succeeded ───
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession?.user) {
              setIsValidRecovery(true);
              // Clean the URL
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete('code');
                url.searchParams.delete('type');
                url.searchParams.delete('token_hash');
                window.history.replaceState({}, '', url.pathname + url.search + url.hash);
              } catch {}
              setVerifying(false);
              return;
            }
            setIsValidRecovery(false);
            setVerifying(false);
            return;
          }
          // Clean the URL
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('code');
            url.searchParams.delete('type');
            url.searchParams.delete('token_hash');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          } catch {}
        }

        // ─── FINAL: Verify we have a valid session ───
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setIsValidRecovery(true);
        } else {
          setIsValidRecovery(false);
        }
      } catch {
        setIsValidRecovery(false);
      } finally {
        setVerifying(false);
      }
    };

    verifyRecovery();
  }, []);

  const strength = getPasswordStrength(newPassword);
  const strengthLabel = strength === 1 ? t('auth.passwordStrength.weak') : strength === 2 ? t('auth.passwordStrength.fair') : strength === 3 ? t('auth.passwordStrength.strong') : '';
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const mismatch = confirmPassword && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= 6 && passwordsMatch && !isLoading;

  const getStrengthLabel = (s: number) => {
    if (s <= 0) return t('auth.passwordStrength.veryWeak');
    if (s === 1) return t('auth.passwordStrength.weak');
    if (s === 2) return t('auth.passwordStrength.fair');
    return t('auth.passwordStrength.strong');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      toast.error(t('auth.passwordMinLength'));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(t('auth.passwordsDontMatch'));
      return;
    }

    setIsLoading(true);
    try {
      // ── Verify session is still valid before updating password ──
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.user) {
        toast.error(t('auth.expiredSession'));
        setIsLoading(false);
        return;
      }

      // ── Call updateUser ──
      const result = await supabase.auth.updateUser({ password: newPassword });
      const error = result.error;

      if (error) {
        console.error('[UpdatePassword] Error:', {
          message: error.message,
          name: error.name,
          status: (error as any).status,
          code: (error as any).code,
        });
        const msg = error.message?.toLowerCase() || '';

        if (msg.includes('same') || msg.includes('different') || msg.includes('old password')) {
          toast.error(t('auth.passwordDifferent'));
        } else if (msg.includes('session') || msg.includes('unauthenticated') || msg.includes('not found') || msg.includes('jwt') || msg.includes('token')) {
          toast.error(t('auth.expiredSession'));
        } else if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
          toast.error(t('common.tooManyRequests'));
        } else if (msg.includes('password') || msg.includes('weak') || msg.includes('require') || msg.includes('strength') || msg.includes('policy') || msg.includes('validation') || msg.includes('criteria')) {
          toast.error(t('auth.passwordNotMeetRequirements'));
        } else {
          // Show the ACTUAL error from Supabase — no more hiding!
          toast.error(t('auth.errorWithMessage', { message: error.message }));
        }
        setIsLoading(false);
        return;
      }

      setIsSuccess(true);
      toast.success(t('auth.updatePasswordSuccess'));

      // Sign out after a short delay so the user can see the success message
      setTimeout(async () => {
        await supabase.auth.signOut();
        onSuccess();
      }, 2000);
    } catch (err: any) {
      console.error('[UpdatePassword] Unexpected error:', err);
      toast.error(t('auth.unexpectedAuthError', { message: err?.message || t('auth.fallbackError') }));
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while verifying recovery session
  if (verifying) {
    return (
      <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
            <p className="text-sm text-gray-500">{t('auth.verifyingLink')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid or expired link
  if (!isValidRecovery) {
    return (
      <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' as const }}
        >
          <Card className="border-0 shadow-2xl bg-white/95 dark:bg-card/95 backdrop-blur-sm">
            <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100">
                <ShieldCheck className="h-7 w-7 text-rose-600" />
              </div>
              <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
                {t('auth.invalidOrExpiredLink')}
              </CardTitle>
              <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
                {t('auth.invalidResetLinkDescFull')}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 px-4 sm:px-6 pb-4 sm:pb-6">
              <Button
                type="button"
                onClick={onSuccess}
                variant="outline"
                className="w-full h-11 text-base font-medium border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-muted/50"
              >
                {t('common.returnToLogin')}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="border-0 shadow-2xl bg-white/95 dark:bg-card/95 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-9 w-9 text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">{t('auth.passwordUpdated')}</h3>
              <p className="text-sm text-gray-500">{t('auth.passwordUpdatedDesc')}</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Main form
  return (
    <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card className="border-0 shadow-2xl bg-white/95 dark:bg-card/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100">
              <Lock className="h-6 w-6 text-sky-600" />
            </div>
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              {t('auth.setNewPassword')}
            </CardTitle>
            <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
              {t('auth.setNewPasswordDesc')}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 sm:pt-4 px-4 sm:px-6 pb-4 sm:pb-6">
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              {/* New Password */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="space-y-2"
              >
                <Label htmlFor="new-password" className="text-gray-700 font-medium text-xs sm:text-sm">
                  {t('auth.newPassword')}
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('auth.enterNewPassword')}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pe-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20"
                    disabled={isLoading}
                    dir="ltr"
                    maxLength={128}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground transition-colors touch-target flex items-center justify-center"
                    tabIndex={-1}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* Password strength indicator */}
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
              </motion.div>

              {/* Confirm Password */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-2"
              >
                <Label htmlFor="confirm-password" className="text-gray-700 font-medium text-xs sm:text-sm">
                  {t('auth.confirmPassword')}
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder={t('auth.reenterPassword')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`pe-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 ${
                      mismatch ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' 
                      : passwordsMatch ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20'
                      : 'border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20'
                    }`}
                    disabled={isLoading}
                    dir="ltr"
                    maxLength={128}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground transition-colors touch-target flex items-center justify-center"
                    tabIndex={-1}
                    aria-label={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
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
              </motion.div>

              {/* Submit */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700 shadow-lg shadow-sky-500/25 transition-all duration-300 dark:from-sky-600 dark:to-teal-500 dark:hover:from-sky-700 dark:hover:to-teal-600"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{t('auth.updating')}</span>
                    </>
                  ) : (
                    t('auth.updatePassword')
                  )}
                </Button>
              </motion.div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
