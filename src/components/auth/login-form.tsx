'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, KeyRound } from 'lucide-react';
import {
  Card, Text, TextInput, PasswordInput, Button, SegmentedControl,
  Stack, Group, Box, Anchor, Image, Center,
} from '@mantine/core';
import { useAuthStore } from '@/stores/auth-store';
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
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('email');

  const { signInWithEmail } = useAuthStore();
  const { setCurrentPage } = useAppStore();
  const { institution, fetchInstitution, loaded } = useInstitutionStore();
  const { t, isRTL } = useTranslations();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  const displayName = loaded ? (institution?.name || t('common.appName')) : '';
  const displayLogo = institution?.logo_url;

  const routeAfterLogin = () => {
    const user = useAuthStore.getState().user;
    if (user) {
      toast.success(t('auth.loginSuccess'));
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
      toast.error('الرجاء إدخال الكود');
      return;
    }
    if (!password.trim()) {
      toast.error(t('auth.pleaseEnterPassword'));
      return;
    }
    setIsLoading(true);
    try {
      const resolveRes = await fetch('/api/auth/resolve-student-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentCode: studentCode.trim() }),
      });
      const resolveJson = await resolveRes.json();
      if (!resolveJson.success) {
        toast.error(resolveJson.error || 'الكود غير صحيح');
        return;
      }
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

  const handleSubmit = mode === 'email' ? handleEmailSubmit : handleCodeSubmit;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card
          shadow="xl"
          radius="lg"
          padding="xl"
          withBorder={false}
          style={{
            backgroundColor: 'var(--mantine-color-body)',
            flex: 1,
          }}
        >
          <Stack gap="md" align="center" mb="md">
            {displayLogo && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              >
                <Box
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    backgroundColor: 'var(--mantine-primary-color-filled)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Image src={displayLogo} alt={displayName} h="100%" w="100%" fit="cover" />
                </Box>
              </motion.div>
            )}
            <Stack gap={4} align="center">
              <Text size="xl" fw={700}>
                {displayName ? t('auth.welcomeTo', { name: displayName }) : t('auth.welcome')}
              </Text>
              <Text size="sm" c="dimmed">
                {t('auth.loginToContinue')}
              </Text>
            </Stack>
          </Stack>

          {/* Mode switcher */}
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as LoginMode)}
            data={[
              { label: '📧 بالبريد الإلكتروني', value: 'email' },
              { label: '🔑 بالكود', value: 'code' },
            ]}
            fullWidth
            radius="md"
            size="sm"
            mb="md"
          />

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              {mode === 'email' ? (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
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
              ) : (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <TextInput
                    label="الكود"
                    placeholder="مثال: A1B2C3D4"
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value.toUpperCase())}
                    leftSection={<KeyRound size={16} />}
                    disabled={isLoading}
                    dir="ltr"
                    maxLength={40}
                    size="md"
                    radius="md"
                    styles={{ input: { fontFamily: 'monospace', letterSpacing: '0.1em' } }}
                  />
                </motion.div>
              )}

              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                <PasswordInput
                  label={t('auth.password')}
                  placeholder={t('auth.enterPassword')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  leftSection={<Lock size={16} />}
                  visibilityToggleIcon={({ reveal }) => (reveal ? <EyeOff size={16} /> : <Eye size={16} />)}
                  disabled={isLoading}
                  dir="ltr"
                  size="md"
                  radius="md"
                />
              </motion.div>

              {onForgotPassword && mode === 'email' && (
                <Group justify="flex-end">
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={onForgotPassword}
                  >
                    {t('auth.forgotPassword')}
                  </Anchor>
                </Group>
              )}

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Button
                  type="submit"
                  loading={isLoading}
                  fullWidth
                  size="md"
                  radius="md"
                >
                  {isLoading ? t('auth.loggingIn') : t('auth.login')}
                </Button>
              </motion.div>
            </Stack>
          </form>

          {onSwitchToRegister && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
            >
              <Center mt="lg">
                <Text size="sm" c="dimmed">
                  {t('auth.noAccount')}{' '}
                  <Anchor component="button" type="button" size="sm" fw={600} onClick={() => onSwitchToRegister()}>
                    {t('auth.createAccount')}
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
