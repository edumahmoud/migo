'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, Loader2, KeyRound, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth-store';
import { bioSupported, bioHasLogin, bioLogin, bioOffer } from '@/lib/native-bio';
import { useAppStore } from '@/stores/app-store';
import { useInstitutionStore } from '@/stores/institution-store';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';

interface LoginFormProps {
  onSwitchToRegister?: () => void;
  onForgotPassword?: () => void;
}

type LoginMode = 'email' | 'code';

export default function LoginForm({ onSwitchToRegister, onForgotPassword }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('email');

  const { signInWithEmail } = useAuthStore();
  const { setCurrentPage } = useAppStore();
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t, isRTL } = useTranslations();

  // Fetch institution data on mount
  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  const displayName = loaded ? (institution?.name || t('common.appName')) : '';
  const displayLogo = institution?.logo_url;

  const routeAfterLogin = () => {
    const user = useAuthStore.getState().user;
    if (user) {
      toast.success(t('auth.loginSuccess'));
      bioOffer();
      if (user.role === 'superadmin' || user.role === 'admin') {
        setCurrentPage('admin-dashboard');
      } else if (user.role === 'teacher') {
        setCurrentPage('teacher-dashboard');
      } else if (user.role === 'registration_agent') {
        setCurrentPage('agent-portal');
      } else {
        setCurrentPage('student-dashboard');
      }
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error(t('auth.pleaseEnterEmail'));
      return;
    }
    if (!password.trim()) {
      toast.error(t('auth.pleaseEnterPassword'));
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await signInWithEmail(email, password);
      if (error) {
        toast.error(error);
        return;
      }
      routeAfterLogin();
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentCode.trim()) {
      toast.error(t('auth.pleaseEnterCode'));
      return;
    }
    if (!password.trim()) {
      toast.error(t('auth.pleaseEnterPassword'));
      return;
    }
    setIsLoading(true);
    try {
      // 1. Resolve the student code → email (server-side).
      const resolveRes = await fetch('/api/auth/resolve-student-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentCode: studentCode.trim() }),
      });
      const resolveJson = await resolveRes.json();
      if (!resolveJson.success) {
        toast.error(resolveJson.error || t('auth.invalidCode'));
        return;
      }

      // 2. Sign in with the resolved email + password.
      const { error } = await signInWithEmail(resolveJson.email, password);
      if (error) {
        toast.error(error);
        return;
      }
      routeAfterLogin();
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchToRegister = () => {
    if (onSwitchToRegister) {
      onSwitchToRegister();
    }
  };

  // Fingerprint login (Android app only). Prompts once automatically when the app opens, and via the button.
  const [bioReady, setBioReady] = useState(false);
  const runBio = async () => {
    setIsLoading(true);
    try {
      const r = await bioLogin(signInWithEmail);
      if (r.ok) routeAfterLogin();
      else if (r.error) toast.error(r.error);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    const ok = bioSupported() && bioHasLogin();
    setBioReady(ok);
    const w = window as unknown as { __attendoBioAuto?: boolean };
    if (ok && !w.__attendoBioAuto) {
      w.__attendoBioAuto = true;
      void runBio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Login with a code sent to the Telegram chat linked through the bot (only for accounts that completed that step).
  const [tgStep, setTgStep] = useState<0 | 1>(0);
  const [tgCode, setTgCode] = useState('');
  const runTg = async () => {
    const mail = email.trim();
    if (!mail.includes('@')) { toast.error('اكتب الإيميل الأول'); return; }
    setIsLoading(true);
    try {
      if (tgStep === 0) {
        const res = await fetch('/api/auth/tg-login/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { toast.error(j.error || 'تعذر الإرسال'); return; }
        toast.success(j.message || 'تم الإرسال');
        setTgStep(1);
      } else {
        const res = await fetch('/api/auth/tg-login/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, code: tgCode }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.tokenHash) { toast.error(j.error || 'الكود غير صحيح'); return; }
        const { error } = await signInWithEmail(j.email, '', { tokenHash: j.tokenHash });
        if (error) toast.error(error); else routeAfterLogin();
      }
    } finally {
      setIsLoading(false);
    }
  };

  // The submit handler depends on the active mode.
  const handleSubmit = mode === 'email' ? handleEmailSubmit : handleCodeSubmit;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card className="auth-login-card border-0 shadow-2xl bg-white/95 dark:bg-card/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            {displayLogo && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                data-login-logo
                className="mx-auto mb-2 sm:mb-4 flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 shadow-lg overflow-hidden"
              >
                <img src={displayLogo} alt={displayName} className="h-full w-full object-cover" />
              </motion.div>
            )}
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              {displayName ? t('auth.welcomeTo', { name: displayName }) : t('auth.welcome')}
            </CardTitle>
            <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
              {t('auth.loginToContinue')}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 sm:pt-4 px-4 sm:px-6 pb-4 sm:pb-6">
            {/* Mode switcher — by email / by student code */}
            <div className="relative grid grid-cols-2 gap-1 p-1 mb-4 rounded-lg bg-gray-100 dark:bg-muted/40 text-sm">
              {([
                { key: 'email', label: t('auth.byEmail'), Icon: Mail },
                { key: 'code', label: t('auth.byCode'), Icon: KeyRound },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`relative py-1.5 px-2 rounded-md flex items-center justify-center gap-1.5 transition-colors duration-300 ${
                    mode === key ? 'font-semibold text-sky-700' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {mode === key && (
                    <motion.span
                      layoutId="login-mode-pill"
                      className="absolute inset-0 rounded-md bg-white dark:bg-background shadow-sm"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    <Icon className="h-4 w-4" />
                    {label}
                  </span>
                </button>
              ))}
            </div>

            {bioReady && (
              <button
                type="button"
                onClick={runBio}
                disabled={isLoading}
                className="w-full h-11 mb-4 rounded-md border border-teal-600 text-teal-700 font-semibold hover:bg-teal-50 disabled:opacity-50 transition-colors"
              >
                الدخول بالبصمة
              </button>
            )}
            <div className="mb-4 space-y-2">
              {tgStep === 1 && (
                <input
                  value={tgCode}
                  onChange={(e) => setTgCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="كود تليجرام (6 أرقام)"
                  dir="ltr"
                  className="w-full h-11 rounded-md border px-3 text-center tracking-widest bg-background"
                />
              )}
              <button
                type="button"
                onClick={runTg}
                disabled={isLoading || (tgStep === 1 && tgCode.length !== 6)}
                className="w-full h-10 rounded-md border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
              >
                {tgStep === 0 ? 'الدخول بكود على تليجرام' : 'تأكيد الكود'}
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-5">
              <AnimatePresence mode="wait" initial={false}>
              {mode === 'email' ? (
                /* Email Field */
                <motion.div
                  key="email-field"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
                  <Label htmlFor="email" className="text-gray-700 font-medium text-xs sm:text-sm">
                    {t('auth.email')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('auth.enterEmail')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="ps-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20"
                      disabled={isLoading}
                      dir="ltr"
                      maxLength={254}
                    />
                    <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-muted-foreground" />
                  </div>
                </motion.div>
              ) : (
                /* Student Code Field */
                <motion.div
                  key="code-field"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
                  <Label htmlFor="student-code" className="text-gray-700 font-medium text-xs sm:text-sm">
                    {t('auth.studentCode')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="student-code"
                      type="text"
                      placeholder={t('auth.studentCodeExample')}
                      value={studentCode}
                      onChange={(e) => setStudentCode(e.target.value.toUpperCase())}
                      className="ps-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20 font-mono tracking-widest"
                      disabled={isLoading}
                      dir="ltr"
                      maxLength={40}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <KeyRound className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-muted-foreground" />
                  </div>

                </motion.div>
              )}
              </AnimatePresence>

              {/* Password Field */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="space-y-2"
              >
                <Label htmlFor="password" className="text-gray-700 font-medium text-xs sm:text-sm">
                  {t('auth.password')}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('auth.enterPassword')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ps-10 pe-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20"
                    disabled={isLoading}
                    dir="ltr"
                  />
                  <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground transition-colors touch-target flex items-center justify-center"
                    tabIndex={-1}
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </motion.div>

              {/* Forgot Password Link */}
              <AnimatePresence initial={false}>
              {onForgotPassword && mode === 'email' && (
                <motion.div
                  key="forgot"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex ms-auto w-fit overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={onForgotPassword}
                    className="text-sm text-sky-600 hover:text-sky-700 font-medium transition-colors"
                  >
                    {t('auth.forgotPassword')}
                  </button>
                </motion.div>
              )}
              </AnimatePresence>

              {/* Submit Button */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700 shadow-lg shadow-sky-500/25 transition-all duration-300 hover:shadow-sky-500/40 dark:from-sky-600 dark:to-teal-500 dark:hover:from-sky-700 dark:hover:to-teal-600"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{t('auth.loggingIn')}</span>
                    </>
                  ) : (
                    t('auth.login')
                  )}
                </Button>
              </motion.div>
            </form>

            {/* Register Link - uses onSwitchToRegister prop */}
            {onSwitchToRegister && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                data-login-register
                className="mt-3 sm:mt-6 text-center"
              >
                <p className="text-sm text-gray-500">
                  {t('auth.noAccount')}{' '}
                  <button
                    type="button"
                    onClick={handleSwitchToRegister}
                    className="font-semibold text-sky-600 hover:text-sky-700 transition-colors hover:underline"
                  >
                    {t('auth.createAccount')}
                  </button>
                </p>
              </motion.div>
            )}

            {/* Legal links */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="mt-4 sm:mt-5 text-center"
            >
              <p className="text-xs text-gray-400">
                <a href="/terms" target="_blank" rel="noreferrer" className="hover:text-sky-600 hover:underline transition-colors">
                  {t('legal.terms')}
                </a>
                {' · '}
                <a href="/refund" target="_blank" rel="noreferrer" className="hover:text-sky-600 hover:underline transition-colors">
                  {t('legal.refund')}
                </a>
                {' · '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="hover:text-sky-600 hover:underline transition-colors">
                  {t('legal.privacy')}
                </a>
              </p>
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
