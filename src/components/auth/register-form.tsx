'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, GraduationCap, User, Phone } from 'lucide-react';
import {
  Card, Text, TextInput, PasswordInput, Button, Stack, Group, Box, Anchor, Image, Center, Progress,
} from '@mantine/core';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { useInstitutionStore } from '@/stores/institution-store';
import { useTranslations } from '@/i18n/use-translations';
import { normalizePhoneToE164, isParseablePhoneInput } from '@/lib/phone-utils';
import { toast } from 'sonner';

interface RegisterFormProps {
  onSwitchToLogin?: () => void;
}

type StrengthColor = 'red' | 'yellow' | 'blue' | 'teal';

function getPasswordStrength(password: string, t: (key: string) => string): {
  score: number;
  label: string;
  color: StrengthColor;
} {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: t('auth.passwordStrength.weak'), color: 'red' };
  if (score <= 2) return { score, label: t('auth.passwordStrength.fair'), color: 'yellow' };
  if (score <= 3) return { score, label: t('auth.passwordStrength.good'), color: 'blue' };
  return { score, label: t('auth.passwordStrength.strong'), color: 'teal' };
}

export default function RegisterForm({ onSwitchToLogin }: RegisterFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { signUpWithEmail } = useAuthStore();
  const { setCurrentPage } = useAppStore();
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t, isRTL } = useTranslations();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  const displayName = institution?.name || t('common.appName');
  const displayLogo = institution?.logo_url;
  const passwordStrength = useMemo(() => getPasswordStrength(password, t), [password, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error(t('auth.pleaseEnterName')); return; }
    if (!email.trim()) { toast.error(t('auth.pleaseEnterEmail')); return; }
    if (!phone.trim()) { toast.error('الرجاء إدخال رقم الهاتف'); return; }
    if (!isParseablePhoneInput(phone.trim())) { toast.error('رقم الهاتف غير صحيح'); return; }
    const normalizedPhone = normalizePhoneToE164(phone.trim());
    if (!normalizedPhone) { toast.error('تعذّر تحويل رقم الهاتف إلى الصيغة الدولية (+201234567890)'); return; }
    if (!password.trim()) { toast.error(t('auth.pleaseEnterPassword')); return; }
    if (password.length < 6) { toast.error(t('auth.passwordMinLength')); return; }
    if (password !== confirmPassword) { toast.error(t('auth.passwordsDontMatch')); return; }

    setIsLoading(true);
    try {
      const { error, needsConfirmation } = await signUpWithEmail(email, password, name, normalizedPhone);
      if (error) { toast.error(error); return; }

      if (needsConfirmation) {
        toast.success(t('auth.confirmationSent'), { duration: 8000 });
      } else {
        toast.success(t('auth.accountCreated'));
        const user = useAuthStore.getState().user;
        if (user) {
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
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
          <Stack gap="md" align="center" mb="md">
            {displayLogo && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              >
                <Box
                  style={{
                    width: 64, height: 64, borderRadius: 16,
                    backgroundColor: 'var(--mantine-primary-color-filled)',
                    overflow: 'hidden',
                  }}
                >
                  <Image src={displayLogo} alt={displayName} h="100%" w="100%" fit="cover" />
                </Box>
              </motion.div>
            )}
            <Stack gap={4} align="center">
              <Text size="xl" fw={700}>{t('auth.registerTitle')}</Text>
              <Text size="sm" c="dimmed">{t('auth.joinPlatform', { name: displayName })}</Text>
            </Stack>
          </Stack>

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}>
                <TextInput
                  label={t('auth.fullName')}
                  placeholder={t('auth.enterFullName')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  leftSection={<User size={16} />}
                  disabled={isLoading}
                  maxLength={100}
                  size="md"
                  radius="md"
                />
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}>
                <TextInput
                  label={<span>رقم الهاتف <span style={{ color: 'var(--mantine-color-red-5)' }}>*</span></span>}
                  placeholder="01000000000 (أو +201000000000)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  leftSection={<Phone size={16} />}
                  disabled={isLoading}
                  dir="ltr"
                  maxLength={20}
                  size="md"
                  radius="md"
                />
                <Text size="xs" c="dimmed" mt={4}>
                  سيتم تحويل الرقم تلقائياً إلى صيغة دولية (+20…) وإرسال كود عبر تليجرام.
                </Text>
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
                <TextInput
                  label={t('auth.email')}
                  placeholder={t('auth.enterEmail')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  leftSection={<Mail size={16} />}
                  disabled={isLoading}
                  dir="ltr"
                  maxLength={254}
                  size="md"
                  radius="md"
                />
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 }}>
                <PasswordInput
                  label={t('auth.password')}
                  placeholder={t('auth.createStrongPassword')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftSection={<Lock size={16} />}
                  visibilityToggleIcon={({ reveal }) => (reveal ? <EyeOff size={16} /> : <Eye size={16} />)}
                  disabled={isLoading}
                  dir="ltr"
                  size="md"
                  radius="md"
                />
                {password.length > 0 && (
                  <Stack gap={4} mt={6}>
                    <Progress
                      value={(passwordStrength.score / 5) * 100}
                      color={passwordStrength.color}
                      size="xs"
                      radius="xl"
                    />
                    <Text size="xs" c="dimmed">
                      {t('auth.passwordStrengthLabel')}: {passwordStrength.label}
                    </Text>
                  </Stack>
                )}
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
                <PasswordInput
                  label={t('auth.confirmPassword')}
                  placeholder={t('auth.reenterPassword')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  leftSection={<Lock size={16} />}
                  visibilityToggleIcon={({ reveal }) => (reveal ? <EyeOff size={16} /> : <Eye size={16} />)}
                  disabled={isLoading}
                  dir="ltr"
                  size="md"
                  radius="md"
                  error={confirmPassword && password !== confirmPassword ? t('auth.passwordsDontMatch') : undefined}
                />
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.45 }}>
                <Box
                  p="sm"
                  style={{
                    borderRadius: 8,
                    backgroundColor: 'var(--mantine-primary-color-light)',
                    border: '1px solid var(--mantine-primary-color-light)',
                  }}
                >
                  <Group gap="sm" align="flex-start">
                    <GraduationCap size={16} style={{ color: 'var(--mantine-primary-color-filled)', flexShrink: 0, marginTop: 2 }} />
                    <Text size="xs" c="var(--mantine-primary-color-filled)">
                      {t('auth.studentNote')}
                    </Text>
                  </Group>
                </Box>
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                <Button type="submit" loading={isLoading} fullWidth size="md" radius="md">
                  {isLoading ? t('auth.registering') : t('auth.register')}
                </Button>
              </motion.div>
            </Stack>
          </form>

          {onSwitchToLogin && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
              <Center mt="lg">
                <Text size="sm" c="dimmed">
                  {t('auth.hasAccount')}{' '}
                  <Anchor component="button" type="button" size="sm" fw={600} onClick={() => onSwitchToLogin()}>
                    {t('auth.loginYourAccount')}
                  </Anchor>
                </Text>
              </Center>
            </motion.div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
