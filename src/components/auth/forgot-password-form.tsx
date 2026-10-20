'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import {
  Card, Text, TextInput, Button, Stack, Group, Box, Anchor, Center, Alert,
} from '@mantine/core';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';

// ─── Constants ───
const REQUEST_TIMEOUT_MS = 15_000;
const COOLDOWN_SECONDS = 60;
const STORAGE_KEY = 'attendo_reset_pwd_last_sent';

// ─── Helpers ───
function getLastSentTime(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function setLastSentTime(ts: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch { /* ignore */ }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function withSupabaseTimeout<Res extends { data: unknown; error: { message: string; status?: number; code?: string } | null }>(
  promise: Promise<Res>,
  ms: number,
  t: (key: string, params?: Record<string, string | number | Date>) => string,
): Promise<{ data: Res['data'] | null; error: { message: string; status?: number; code?: string } | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ data: null, error: { message: t('auth.requestTimeoutSeconds', { seconds: String(Math.round(ms / 1000)) }) } });
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        if (res.error) {
          resolve({ data: null, error: { message: res.error.message, status: res.error.status, code: (res.error as any).code } });
        } else {
          resolve({ data: res.data, error: null });
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve({ data: null, error: { message: err?.message || t('auth.connectionErrorOccurred'), status: err?.status, code: (err as any)?.code } });
      });
  });
}

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export default function ForgotPasswordForm({ onBackToLogin }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const { t, direction } = useTranslations();

  useEffect(() => {
    const lastSent = getLastSentTime();
    const elapsed = Math.floor((Date.now() - lastSent) / 1000);
    const remaining = Math.max(0, COOLDOWN_SECONDS - elapsed);
    if (remaining > 0) setCooldownRemaining(remaining);

    const interval = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatCooldown = useCallback((seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`;
    return `${s} ${t('auth.seconds')}`;
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast.error(t('auth.pleaseEnterEmail')); return; }
    if (!isValidEmail(email)) { toast.error(t('auth.invalidEmailFormat')); return; }
    if (cooldownRemaining > 0) { toast.error(t('auth.pleaseWaitTime', { time: formatCooldown(cooldownRemaining) })); return; }
    if (!isSupabaseConfigured) {
      toast.error(t('auth.serverConfigErrorContact'));
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await withSupabaseTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }),
        REQUEST_TIMEOUT_MS,
        t as (key: string, params?: Record<string, string | number | Date>) => string,
      );

      if (error) {
        const msg = error.message?.toLowerCase() || '';
        const status = error.status;
        const errorCode = error.code;

        if (status === 429 || msg.includes('rate limit') || msg.includes('too many') || msg.includes('429')) {
          setLastSentTime(Date.now());
          setCooldownRemaining(COOLDOWN_SECONDS);
          toast.error(t('auth.rateLimitExceeded'));
        } else if (msg.includes('timeout') || msg.includes('timed out')) {
          toast.error(t('auth.connectionTimeoutCheck'));
        } else if (msg.includes('email not found') || msg.includes('user not found') || msg.includes('no user found')) {
          setEmailSent(true);
        } else if (msg.includes('redirect') || msg.includes('url not allowed') || errorCode === 'url_not_allowed' || status === 403) {
          toast.error(t('auth.resetLinkConfigError'));
        } else if (msg.includes('failed to fetch') || msg.includes('network')) {
          toast.error(t('auth.serverConnectionFailedCheck'));
        } else if (msg.includes('invalid api key') || status === 401) {
          toast.error(t('auth.serverConfigContactTech'));
        } else {
          const displayMsg = error.message?.length > 100 ? error.message.substring(0, 100) + '...' : error.message;
          toast.error(t('auth.errorWithMessage', { message: displayMsg }));
        }
        return;
      }

      setLastSentTime(Date.now());
      setCooldownRemaining(COOLDOWN_SECONDS);
      setEmailSent(true);
      toast.success(t('auth.resetLinkSentSuccess'));
    } catch (err) {
      toast.error(t('auth.unexpectedErrorRetry'));
    } finally {
      setIsLoading(false);
    }
  };

  const canResend = cooldownRemaining === 0 && !isLoading;

  return (
    <div dir={direction} className="w-full max-w-md mx-auto flex flex-col h-full sm:h-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
      >
        <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
          <Stack gap="xs" align="center" mb="md">
            <Text size="xl" fw={700}>{t('auth.restorePassword')}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {emailSent ? t('auth.resetLinkSentDesc') : t('auth.resetPasswordDesc')}
            </Text>
          </Stack>

          {emailSent ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <Stack gap="md" align="center">
                <Box
                  style={{
                    width: 64, height: 64, borderRadius: '50%',
                    backgroundColor: 'var(--mantine-primary-color-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <CheckCircle2 size={32} style={{ color: 'var(--mantine-primary-color-filled)' }} />
                </Box>
                <Text size="sm" ta="center">
                  {t('auth.resetLinkSentToEmail')} <Text component="span" fw={600}>{email}</Text>
                </Text>
                <Text size="xs" c="dimmed" ta="center">{t('auth.checkInboxSpam')}</Text>

                {cooldownRemaining > 0 ? (
                  <Alert color="yellow" variant="light" icon={<Clock size={14} />} radius="md" w="100%">
                    {t('auth.canResendAfter', { time: formatCooldown(cooldownRemaining) })}
                  </Alert>
                ) : (
                  <Button variant="outline" fullWidth size="md" radius="md" onClick={() => setEmailSent(false)}>
                    {t('auth.resendLink')}
                  </Button>
                )}

                <Button variant="subtle" fullWidth size="md" radius="md" onClick={onBackToLogin}>
                  {t('common.returnToLogin')}
                </Button>
              </Stack>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
                  <TextInput
                    label={t('auth.email')}
                    placeholder={t('auth.enterRegisteredEmail')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    leftSection={<Mail size={16} />}
                    disabled={isLoading || cooldownRemaining > 0}
                    dir="ltr"
                    maxLength={254}
                    size="md"
                    radius="md"
                  />
                </motion.div>

                {cooldownRemaining > 0 && (
                  <Alert color="yellow" variant="light" icon={<Clock size={14} />} radius="md">
                    {t('auth.pleaseWaitNewLink', { time: formatCooldown(cooldownRemaining) })}
                  </Alert>
                )}

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                  <Button type="submit" loading={isLoading} disabled={!canResend} fullWidth size="md" radius="md">
                    {isLoading
                      ? t('auth.sending')
                      : cooldownRemaining > 0
                        ? t('auth.waitTime', { time: formatCooldown(cooldownRemaining) })
                        : t('auth.sendResetLink')}
                  </Button>
                </motion.div>

                <Group justify="center">
                  <Anchor component="button" type="button" size="sm" onClick={onBackToLogin}>
                    <Group gap={4}>
                      <ArrowRight size={14} />
                      {t('common.returnToLogin')}
                    </Group>
                  </Anchor>
                </Group>
              </Stack>
            </form>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
