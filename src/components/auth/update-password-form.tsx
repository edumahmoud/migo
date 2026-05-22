'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, Loader2, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
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

const strengthLabels = ['ضعيفة', 'متوسطة', 'قوية'];
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

  // Verify that we have a valid recovery session
  useEffect(() => {
    const verifyRecovery = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // If we have a session and this component is rendered, it's because
          // the auth store detected a PASSWORD_RECOVERY event or the URL had
          // type=recovery. Either way, the session is valid for password update.
          setIsValidRecovery(true);
        } else {
          // No session — invalid or expired link
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
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const mismatch = confirmPassword && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= 6 && passwordsMatch && !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        toast.error('حدث خطأ أثناء تحديث كلمة المرور. يرجى المحاولة مرة أخرى');
        return;
      }

      setIsSuccess(true);
      toast.success('تم تحديث كلمة المرور بنجاح');

      // Sign out after a short delay so the user can see the success message
      setTimeout(async () => {
        await supabase.auth.signOut();
        onSuccess();
      }, 2000);
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while verifying recovery session
  if (verifying) {
    return (
      <div dir="rtl" className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
            <p className="text-sm text-gray-500">جارٍ التحقق من الرابط...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid or expired link
  if (!isValidRecovery) {
    return (
      <div dir="rtl" className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' as const }}
        >
          <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
            <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100">
                <ShieldCheck className="h-7 w-7 text-rose-600" />
              </div>
              <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
                الرابط غير صالح أو منتهي
              </CardTitle>
              <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
                رابط إعادة تعيين كلمة المرور غير صالح أو انتهت صلاحيته. يرجى طلب رابط جديد.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 px-4 sm:px-6 pb-4 sm:pb-6">
              <Button
                type="button"
                onClick={onSuccess}
                variant="outline"
                className="w-full h-11 text-base font-medium border-gray-200 hover:bg-gray-50"
              >
                العودة لتسجيل الدخول
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
      <div dir="rtl" className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-9 w-9 text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">تم تحديث كلمة المرور</h3>
              <p className="text-sm text-gray-500">سيتم تحويلك لصفحة تسجيل الدخول...</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    );
  }

  // Main form
  return (
    <div dir="rtl" className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100">
              <Lock className="h-6 w-6 text-sky-600" />
            </div>
            <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900">
              تعيين كلمة مرور جديدة
            </CardTitle>
            <CardDescription className="text-gray-500 mt-1 sm:mt-2 text-xs sm:text-sm">
              أدخل كلمة المرور الجديدة لحسابك
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
                  كلمة المرور الجديدة
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="أدخل كلمة المرور الجديدة"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pr-10 h-10 sm:h-11 bg-gray-50/50 border-gray-200 focus:border-sky-500 focus:ring-sky-500/20 text-right"
                    disabled={isLoading}
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
                {/* Password strength indicator */}
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
              </motion.div>

              {/* Confirm Password */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-2"
              >
                <Label htmlFor="confirm-password" className="text-gray-700 font-medium text-xs sm:text-sm">
                  تأكيد كلمة المرور
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="أعد إدخال كلمة المرور"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`pr-10 h-10 sm:h-11 bg-gray-50/50 text-right ${
                      mismatch ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' 
                      : passwordsMatch ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20'
                      : 'border-gray-200 focus:border-sky-500 focus:ring-sky-500/20'
                    }`}
                    disabled={isLoading}
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
                  className="w-full h-11 text-base font-semibold bg-gradient-to-l from-sky-700 to-teal-600 hover:from-sky-800 hover:to-teal-700 shadow-lg shadow-sky-500/25 transition-all duration-300"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>جارٍ التحديث...</span>
                    </>
                  ) : (
                    'تحديث كلمة المرور'
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
