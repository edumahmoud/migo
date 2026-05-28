'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  GraduationCap,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useInstitutionStore } from '@/stores/institution-store';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';

interface RegisterFormProps {
  onSwitchToLogin?: () => void;
}

/** Password strength calculator */
function getPasswordStrength(password: string, t: (key: string) => string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: t('auth.passwordStrength.weak'), color: 'bg-red-500' };
  if (score <= 2) return { score, label: t('auth.passwordStrength.fair'), color: 'bg-yellow-500' };
  if (score <= 3) return { score, label: t('auth.passwordStrength.good'), color: 'bg-blue-500' };
  return { score, label: t('auth.passwordStrength.strong'), color: 'bg-teal-500' };
}

export default function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const { signUpWithEmail, signInWithGoogle } = useAuthStore();
  const { setCurrentPage } = useAppStore();
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t, isRTL } = useTranslations();

  // Fetch institution data on mount
  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  const displayName = institution?.name || t('common.appName');
  const displayLogo = institution?.logo_url;

  const passwordStrength = useMemo(() => getPasswordStrength(password, t), [password, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(t('auth.pleaseEnterName'));
      return;
    }
    if (!email.trim()) {
      toast.error(t('auth.pleaseEnterEmail'));
      return;
    }
    if (!password.trim()) {
      toast.error(t('auth.pleaseEnterPassword'));
      return;
    }
    if (password.length < 6) {
      toast.error(t('auth.passwordMinLength'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('auth.passwordsDontMatch'));
      return;
    }

    setIsLoading(true);
    try {
      const { error, needsConfirmation } = await signUpWithEmail(email, password, name);
      if (error) {
        toast.error(error);
        return;
      }

      if (needsConfirmation) {
        toast.success(t('auth.confirmationSent'), {
          duration: 8000,
        });
      } else {
        toast.success(t('auth.accountCreated'));
        // Check the user's role after signup (might be superadmin if first user)
        const user = useAuthStore.getState().user;
        if (user) {
          if (user.role === 'superadmin' || user.role === 'admin') {
            setCurrentPage('admin-dashboard');
          } else if (user.role === 'teacher') {
            setCurrentPage('teacher-dashboard');
          } else {
            setCurrentPage('student-dashboard');
          }
        }
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast.error(error);
      }
      // Google OAuth redirects away - the auth state change listener
      // in the auth store will handle navigation after redirect back
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const handleSwitchToLogin = () => {
    if (onSwitchToLogin) {
      onSwitchToLogin();
    }
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card className="border-0 shadow-2xl bg-white/95 dark:bg-card/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block overflow-y-auto">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            {displayLogo && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="mx-auto mb-2 sm:mb-4 flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 shadow-lg overflow-hidden"
              >
                <img src={displayLogo} alt={displayName} className="h-full w-full object-cover" />
              </motion.div>
            )}
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              {t('auth.registerTitle')}
            </CardTitle>
            <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
              {t('auth.joinPlatform', { name: displayName })}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-2 sm:pt-4 px-4 sm:px-6 pb-4 sm:pb-6">
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              {/* Name Field */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 }}
                className="space-y-2"
              >
                <Label htmlFor="reg-name" className="text-gray-700 font-medium text-xs sm:text-sm">
                  {t('auth.fullName')}
                </Label>
                <div className="relative">
                  <Input
                    id="reg-name"
                    type="text"
                    placeholder={t('auth.enterFullName')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="ps-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20"
                    disabled={isLoading}
                    maxLength={100}
                  />
                  <User className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-muted-foreground" />
                </div>
              </motion.div>

              {/* Email Field */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-2"
              >
                <Label htmlFor="reg-email" className="text-gray-700 font-medium text-xs sm:text-sm">
                  {t('auth.email')}
                </Label>
                <div className="relative">
                  <Input
                    id="reg-email"
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

              {/* Password Field with Strength Indicator */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 }}
                className="space-y-2"
              >
                <Label htmlFor="reg-password" className="text-gray-700 font-medium text-xs sm:text-sm">
                  {t('auth.password')}
                </Label>
                <div className="relative">
                  <Input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('auth.createStrongPassword')}
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
                {/* Password Strength Indicator */}
                {password.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div
                          key={level}
                          className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                            level <= passwordStrength.score
                              ? passwordStrength.color
                              : 'bg-gray-200 dark:bg-gray-800'
                          }`}
                        />
                      ))}
                    </div>
                    <p className={`text-xs font-medium ${
                      passwordStrength.score <= 1 ? 'text-red-500 dark:text-red-500' :
                      passwordStrength.score <= 2 ? 'text-yellow-600 dark:text-yellow-400' :
                      passwordStrength.score <= 3 ? 'text-blue-600 dark:text-blue-400' :
                      'text-teal-600 dark:text-teal-500'
                    }`}>
                      {t('auth.passwordStrengthLabel')}: {passwordStrength.label}
                    </p>
                  </div>
                )}
              </motion.div>

              {/* Confirm Password Field */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="space-y-2"
              >
                <Label
                  htmlFor="reg-confirm-password"
                  className="text-gray-700 dark:text-foreground font-medium text-xs sm:text-sm"
                >
                  {t('auth.confirmPassword')}
                </Label>
                <div className="relative">
                  <Input
                    id="reg-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder={t('auth.reenterPassword')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="ps-10 pe-10 h-10 sm:h-11 bg-gray-50/50 dark:bg-input/50 border-gray-200 dark:border-border focus:border-sky-500 focus:ring-sky-500/20"
                    disabled={isLoading}
                    dir="ltr"
                  />
                  <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-muted-foreground" />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground transition-colors touch-target flex items-center justify-center"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </motion.div>

              {/* Info note about account type */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 }}
              >
                <div className="rounded-lg bg-sky-50 dark:bg-sky-900/15 border border-sky-200 dark:border-sky-900/60 p-2 sm:p-3 text-xs text-sky-700 dark:text-sky-400 flex items-start gap-2">
                  <GraduationCap className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {t('auth.studentNote')}
                  </span>
                </div>
              </motion.div>

              {/* Submit Button */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Button
                  type="submit"
                  disabled={isLoading || isGoogleLoading}
                  className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700 shadow-lg shadow-sky-500/25 transition-all duration-300 hover:shadow-sky-500/40 dark:from-sky-600 dark:to-teal-500 dark:hover:from-sky-700 dark:hover:to-teal-600"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{t('auth.registering')}</span>
                    </>
                  ) : (
                    t('auth.register')
                  )}
                </Button>
              </motion.div>
            </form>

            {/* Divider */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="relative my-3 sm:my-6"
            >
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-4 text-gray-400">{t('common.or')}</span>
              </div>
            </motion.div>

            {/* Google Sign In */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
            >
              <Button
                type="button"
                variant="outline"
                disabled={isLoading || isGoogleLoading}
                onClick={handleGoogleSignIn}
                className="w-full h-11 text-base font-medium border-gray-200 dark:border-border bg-white dark:bg-input/30 hover:bg-gray-100 dark:hover:bg-muted/50 hover:border-gray-300 dark:hover:border-border active:bg-gray-200 dark:active:bg-muted active:scale-[0.98] transition-all duration-200 text-gray-700 dark:text-foreground hover:text-gray-900 dark:hover:text-foreground"
              >
                {isGoogleLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-500 dark:text-muted-foreground" />
                ) : (
                  <svg className="h-5 w-5 me-2" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                )}
                <span>{t('auth.googleRegister')}</span>
              </Button>
            </motion.div>

            {/* Login Link - uses onSwitchToLogin prop */}
            {onSwitchToLogin && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="mt-3 sm:mt-6 text-center"
              >
                <p className="text-sm text-gray-500">
                  {t('auth.hasAccount')}{' '}
                  <button
                    type="button"
                    onClick={handleSwitchToLogin}
                    className="font-semibold text-sky-600 hover:text-sky-700 transition-colors hover:underline"
                  >
                    {t('auth.loginYourAccount')}
                  </button>
                </p>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
