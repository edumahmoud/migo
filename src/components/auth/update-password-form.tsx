'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import {
  Card, Text, PasswordInput, Button, Stack, Box, Center, Progress,
} from '@mantine/core';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';

interface UpdatePasswordFormProps {
  onSuccess: () => void;
}

function getPasswordStrength(password: string): number {
  let score = 0;
  if (password.length >= 6) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 3);
}

const strengthColors: ['red', 'yellow', 'green'] = ['red', 'yellow', 'green'];

export default function UpdatePasswordForm({ onSuccess }: UpdatePasswordFormProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [isValidRecovery, setIsValidRecovery] = useState(false);
  const { t, direction, isRTL } = useTranslations();

  useEffect(() => {
    const verifyRecovery = async () => {
      try {
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession?.user) {
          setIsValidRecovery(true);
          setVerifying(false);
          return;
        }
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession?.user) {
              setIsValidRecovery(true);
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
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('code');
            url.searchParams.delete('type');
            url.searchParams.delete('token_hash');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
          } catch {}
        }
        const { data: { session } } = await supabase.auth.getSession();
        setIsValidRecovery(!!session?.user);
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

  const getStrengthLabel = (s: number) => {
    if (s <= 0) return t('auth.passwordStrength.veryWeak');
    if (s === 1) return t('auth.passwordStrength.weak');
    if (s === 2) return t('auth.passwordStrength.fair');
    return t('auth.passwordStrength.strong');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) { toast.error(t('auth.passwordMinLength')); return; }
    if (newPassword !== confirmPassword) { toast.error(t('auth.passwordsDontMatch')); return; }

    setIsLoading(true);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.user) {
        toast.error(t('auth.expiredSession'));
        setIsLoading(false);
        return;
      }
      const result = await supabase.auth.updateUser({ password: newPassword });
      const error = result.error;
      if (error) {
        const msg = error.message?.toLowerCase() || '';
        if (msg.includes('same') || msg.includes('different')) toast.error(t('auth.passwordDifferent'));
        else if (msg.includes('session') || msg.includes('unauthenticated') || msg.includes('jwt') || msg.includes('token')) toast.error(t('auth.expiredSession'));
        else if (msg.includes('rate limit') || msg.includes('429')) toast.error(t('common.tooManyRequests'));
        else if (msg.includes('password') || msg.includes('weak') || msg.includes('require') || msg.includes('policy')) toast.error(t('auth.passwordNotMeetRequirements'));
        else toast.error(t('auth.errorWithMessage', { message: error.message }));
        setIsLoading(false);
        return;
      }
      setIsSuccess(true);
      toast.success(t('auth.updatePasswordSuccess'));
      setTimeout(async () => {
        await supabase.auth.signOut();
        onSuccess();
      }, 2000);
    } catch (err: any) {
      toast.error(t('auth.unexpectedAuthError', { message: err?.message || t('auth.fallbackError') }));
    } finally {
      setIsLoading(false);
    }
  };

  if (verifying) {
    return (
      <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
          <Center py={64}>
            <Stack gap="md" align="center">
              <Lock size={32} style={{ color: 'var(--mantine-primary-color-filled)' }} className="animate-pulse" />
              <Text size="sm" c="dimmed">{t('auth.verifyingLink')}</Text>
            </Stack>
          </Center>
        </Card>
      </div>
    );
  }

  if (!isValidRecovery) {
    return (
      <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
            <Stack gap="md" align="center">
              <Box style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: 'var(--mantine-color-red-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={28} color="var(--mantine-color-red-filled)" />
              </Box>
              <Text size="xl" fw={700}>{t('auth.invalidOrExpiredLink')}</Text>
              <Text size="sm" c="dimmed" ta="center">{t('auth.invalidResetLinkDescFull')}</Text>
              <Button variant="outline" fullWidth size="md" radius="md" onClick={onSuccess}>
                {t('common.returnToLogin')}
              </Button>
            </Stack>
          </Card>
        </motion.div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
            <Center py={48}>
              <Stack gap="md" align="center">
                <Box style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: 'var(--mantine-color-green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircle2 size={36} color="var(--mantine-color-green-filled)" />
                </Box>
                <Text size="lg" fw={700}>{t('auth.passwordUpdated')}</Text>
                <Text size="sm" c="dimmed" ta="center">{t('auth.passwordUpdatedDesc')}</Text>
              </Stack>
            </Center>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
          <Stack gap="xs" align="center" mb="md">
            <Box style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: 'var(--mantine-primary-color-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Lock size={24} style={{ color: 'var(--mantine-primary-color-filled)' }} />
            </Box>
            <Text size="xl" fw={700}>{t('auth.setNewPassword')}</Text>
            <Text size="sm" c="dimmed" ta="center">{t('auth.setNewPasswordDesc')}</Text>
          </Stack>

          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
                <PasswordInput
                  label={t('auth.newPassword')}
                  placeholder={t('auth.enterNewPassword')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  visibilityToggleIcon={({ reveal }) => (reveal ? <EyeOff size={16} /> : <Eye size={16} />)}
                  disabled={isLoading}
                  dir="ltr"
                  maxLength={128}
                  size="md"
                  radius="md"
                  autoFocus
                />
                {newPassword.length > 0 && (
                  <Stack gap={4} mt={6}>
                    <Progress
                      value={(strength / 3) * 100}
                      color={strengthColors[strength - 1] || 'gray'}
                      size="xs"
                      radius="xl"
                    />
                    <Text size="xs" c="dimmed">{getStrengthLabel(strength)}</Text>
                  </Stack>
                )}
              </motion.div>

              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
                <PasswordInput
                  label={t('auth.confirmPassword')}
                  placeholder={t('auth.reenterPassword')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  visibilityToggleIcon={({ reveal }) => (reveal ? <EyeOff size={16} /> : <Eye size={16} />)}
                  disabled={isLoading}
                  dir="ltr"
                  maxLength={128}
                  size="md"
                  radius="md"
                  error={mismatch ? t('auth.passwordsDontMatch') : undefined}
                  styles={() => ({
                    input: passwordsMatch ? { borderColor: 'var(--mantine-color-green-5)' } : undefined,
                  })}
                />
                {passwordsMatch && (
                  <Text size="xs" c="green.6" mt={4}>{t('auth.passwordsMatch')}</Text>
                )}
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <Button type="submit" loading={isLoading} disabled={!canSubmit} fullWidth size="md" radius="md">
                  {isLoading ? t('auth.updating') : t('auth.updatePassword')}
                </Button>
              </motion.div>
            </Stack>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
