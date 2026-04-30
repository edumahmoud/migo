'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, Loader2, GraduationCap, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export default function ForgotPasswordForm({ onBackToLogin }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('يرجى إدخال البريد الإلكتروني');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}`,
      });

      if (error) {
        toast.error('حدث خطأ أثناء إرسال رابط إعادة التعيين');
        return;
      }

      setEmailSent(true);
      toast.success('تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني');
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div dir="rtl" className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm flex-1 sm:flex-none flex flex-col sm:block">
          <CardHeader className="text-center pb-1 pt-3 sm:pt-6 sm:pb-2 px-4 sm:px-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="mx-auto mb-2 sm:mb-4 flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg"
            >
              <GraduationCap className="h-8 w-8 text-white" />
            </motion.div>
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
                <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-emerald-100 mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <p className="text-sm text-gray-600">
                  تم إرسال رابط إعادة تعيين كلمة المرور إلى <span className="font-semibold">{email}</span>
                </p>
                <p className="text-xs text-gray-400">
                  يرجى التحقق من صندوق الوارد والبريد غير المرغوب فيه
                </p>
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
                      className="pr-10 h-10 sm:h-11 bg-gray-50/50 border-gray-200 focus:border-emerald-500 focus:ring-emerald-500/20 text-right"
                      disabled={isLoading}
                      dir="ltr"
                      maxLength={254}
                    />
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 text-base font-semibold bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-500/25 transition-all duration-300"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>جارٍ الإرسال...</span>
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
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium transition-colors inline-flex items-center gap-1"
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
