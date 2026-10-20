'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { RefreshCw, LogOut, CheckCircle2, Phone, Send, Pencil } from 'lucide-react';
import {
  Card, Text, TextInput, Button, Stack, Group, Box, Anchor, Alert, Center, Loader,
} from '@mantine/core';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { useAppStore } from '@/stores/app-store';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import { normalizePhoneToE164 } from '@/lib/phone-utils';

type SessionStatus =
  | 'loading'
  | 'pending_start'
  | 'otp_sent'
  | 'verified'
  | 'expired'
  | 'init_error'
  | 'bot_not_configured';

export default function OtpVerificationPage() {
  const { t } = useTranslations();
  const router = useRouter();
  const { signOut, user, setUser } = useAuthStore();
  const { reset: resetAppStore } = useAppStore();

  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [initiating, setInitiating] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingPhone, setEditingPhone] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const phone = (user as { phone?: string } | null)?.phone ?? null;

  const init = useCallback(async () => {
    setInitiating(true);
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/auth/initiate-telegram-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
      });
      const json = await res.json();
      if (json.success) {
        setDeepLink(json.deep_link);
        setBotUsername(json.bot_username);
        setStatus('pending_start');
        setCooldown(60);
      } else {
        setStatus('init_error');
        setErrorMessage(json.error || 'تعذّر بدء جلسة التحقق');
      }
    } catch {
      setStatus('init_error');
      setErrorMessage(t('common.unexpectedError'));
    } finally {
      setInitiating(false);
    }
  }, [t]);

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (status !== 'pending_start') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/verification-status', {
          headers: await getCachedAuthHeaders(),
        });
        const json = await res.json();
        if (json.status === 'otp_sent') {
          setStatus('otp_sent');
          toast.success('تم إرسال الكود إلى Telegram!');
        } else if (json.status === 'verified') {
          setStatus('verified');
          toast.success('تم التحقق من رقم هاتفك! جارٍ فتح صفحة التفعيل...');
          try {
            const meRes = await fetch('/api/auth/me', { headers: await getCachedAuthHeaders() });
            const meJson = await meRes.json();
            if (meJson.profile) setUser(meJson.profile);
          } catch {}
          setTimeout(() => router.push('/'), 1000);
        } else if (json.status === 'expired') {
          setStatus('expired');
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [status, router, setUser]);

  const handleVerify = async () => {
    if (otpCode.length !== 6) { toast.error('أدخل كود من 6 أرقام'); return; }
    setVerifying(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ code: otpCode.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setStatus('verified');
        toast.success('تم التحقق من رقم هاتفك بنجاح!');
        try {
          const meRes = await fetch('/api/auth/me', { headers: await getCachedAuthHeaders() });
          const meJson = await meRes.json();
          if (meJson.profile) setUser(meJson.profile);
        } catch {}
        setTimeout(() => router.push('/'), 1000);
      } else {
        toast.error(json.error || 'الكود غير صحيح');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setOtpCode('');
    await init();
  };

  const handleSavePhone = async () => {
    const normalized = normalizePhoneToE164(newPhone.trim());
    if (!normalized) { toast.error('رقم الهاتف غير صالح. مثال: 01555614624 أو +201555614624'); return; }
    setSavingPhone(true);
    try {
      const res = await fetch('/api/auth/initiate-telegram-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ phone: newPhone.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحديث رقمك وإنشاء جلسة جديدة.');
        setEditingPhone(false);
        setNewPhone('');
        setDeepLink(json.deep_link);
        setBotUsername(json.bot_username);
        setStatus('pending_start');
      } else {
        toast.error(json.error || 'تعذّر تحديث الرقم');
      }
    } catch {
      toast.error(t('common.unexpectedError'));
    } finally {
      setSavingPhone(false);
    }
  };

  const handleSignOut = () => {
    resetAppStore();
    try { signOut(); } catch {}
    router.push('/');
  };

  if (initiating) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--mantine-primary-color-light)' }}>
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="var(--mantine-primary-color-filled)">جارٍ تجهيز جلسة التحقق...</Text>
        </Group>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-3 sm:p-6 flex items-center justify-center" style={{ backgroundColor: 'var(--mantine-primary-color-light)' }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card shadow="xl" radius="lg" padding="xl" withBorder={false} style={{ backgroundColor: 'var(--mantine-color-body)' }}>
          <Stack gap="md" align="center" mb="md">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            >
              <Box
                style={{
                  width: 56, height: 56, borderRadius: 16,
                  backgroundColor: 'var(--mantine-primary-color-filled)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Send size={28} color="white" />
              </Box>
            </motion.div>
            <Stack gap={4} align="center">
              <Text size="xl" fw={700}>تأكيد رقم الهاتف</Text>
              <Text size="sm" c="dimmed" ta="center">
                {status === 'otp_sent' ? 'تم إرسال كود التحقق إلى Telegram.' : 'افتح Telegram واضغط Start لإرسال كود التحقق إليك.'}
              </Text>
            </Stack>
          </Stack>

          <Stack gap="md">
            {/* Phone info */}
            {phone && !editingPhone && (
              <Group justify="center" gap="sm">
                <Phone size={16} />
                <Text size="sm" dir="ltr">{phone}</Text>
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  onClick={() => { setEditingPhone(true); setNewPhone(phone || ''); }}
                  title="تعديل الرقم"
                >
                  <Pencil size={12} />
                </Anchor>
              </Group>
            )}

            {/* Phone edit form */}
            {editingPhone && (
              <Alert color="blue" variant="light" radius="md">
                <Stack gap="sm">
                  <Text size="xs" fw={500}>أدخل الرقم الصحيح</Text>
                  <TextInput
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="01000000000"
                    dir="ltr"
                    disabled={savingPhone}
                    size="sm"
                    autoFocus
                  />
                  <Text size="xs" c="dimmed">
                    سيتم تحويله إلى: <Text component="span" dir="ltr" ff="mono">{normalizePhoneToE164(newPhone) || '—'}</Text>
                  </Text>
                  <Group gap="sm">
                    <Button size="sm" onClick={handleSavePhone} loading={savingPhone} disabled={!newPhone.trim()}>
                      حفظ وإعادة الإرسال
                    </Button>
                    <Button size="sm" variant="subtle" onClick={() => { setEditingPhone(false); setNewPhone(''); }} disabled={savingPhone}>
                      إلغاء
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            )}

            {/* STEP 1: Open Telegram */}
            {status === 'pending_start' && deepLink && !editingPhone && (
              <Stack gap="sm">
                <Alert color="blue" variant="light" radius="md">
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>الخطوة 1: افتح Telegram</Text>
                    <Text size="xs" c="dimmed">
                      اضغط الزر بالأسفل ليفتح محادثة البوت في Telegram. سيظهر زر Start في الأسفل — اضغطه لإرسال الكود إليك.
                    </Text>
                  </Stack>
                </Alert>
                <Anchor href={deepLink} target="_blank" rel="noopener noreferrer" underline="never" w="100%">
                  <Button fullWidth size="md" radius="md" leftSection={<Send size={18} />}>
                    فتح Telegram
                  </Button>
                </Anchor>
                <Center>
                  <Group gap="sm">
                    <Loader size="xs" />
                    <Text size="xs" c="dimmed">في انتظار ضغطك لـ Start في Telegram...</Text>
                  </Group>
                </Center>
              </Stack>
            )}

            {/* STEP 2: Enter OTP */}
            {status === 'otp_sent' && (
              <Stack gap="sm">
                <Alert color="teal" variant="light" radius="md">
                  <Stack gap={4}>
                    <Text size="sm" fw={600}>✅ تم إرسال الكود إلى Telegram</Text>
                    <Text size="xs" c="dimmed">أدخل الكود الذي وصلك في محادثة البوت.</Text>
                  </Stack>
                </Alert>
                <Stack gap="xs">
                  <Text size="sm" fw={500} ta="center">أدخل كود التحقق (6 أرقام)</Text>
                  <TextInput
                    type="text"
                    inputMode="numeric"
                    placeholder="••••••"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={verifying}
                    onKeyDown={(e) => { if (e.key === 'Enter' && otpCode.length === 6) handleVerify(); }}
                    autoFocus
                    size="lg"
                    radius="md"
                    ta="center"
                    styles={{ input: { fontFamily: 'monospace', letterSpacing: '0.5em', fontSize: 24, height: 56 } }}
                  />
                </Stack>
                <Button onClick={handleVerify} loading={verifying} disabled={otpCode.length !== 6} fullWidth size="md" radius="md" leftSection={<CheckCircle2 size={18} />}>
                  تأكيد الكود
                </Button>
              </Stack>
            )}

            {/* Init error */}
            {status === 'init_error' && errorMessage && (
              <Alert color="red" variant="light" radius="md">{errorMessage}</Alert>
            )}

            {/* Expired */}
            {status === 'expired' && (
              <Alert color="yellow" variant="light" radius="md">
                <Stack gap="sm">
                  <Text size="sm" fw={600}>انتهت صلاحية جلسة التحقق</Text>
                  <Button onClick={handleResend} size="sm" variant="outline">طلب كود جديد</Button>
                </Stack>
              </Alert>
            )}

            {/* Verified — redirecting */}
            {status === 'verified' && (
              <Alert color="teal" variant="light" radius="md">
                <Stack gap="sm" align="center">
                  <Loader size="sm" />
                  <Text size="sm">تم التحقق بنجاح! جارٍ التحويل لصفحة التفعيل...</Text>
                </Stack>
              </Alert>
            )}

            {/* Footer: resend + logout */}
            <Group justify="space-between">
              <Anchor
                component="button"
                type="button"
                size="xs"
                onClick={handleResend}
                disabled={cooldown > 0 || initiating}
              >
                <Group gap={4}>
                  <RefreshCw size={12} />
                  {cooldown > 0 ? `إعادة (${cooldown}s)` : 'طلب كود جديد'}
                </Group>
              </Anchor>
              <Anchor
                component="button"
                type="button"
                size="xs"
                c="dimmed"
                onClick={handleSignOut}
              >
                <Group gap={4}>
                  <LogOut size={12} />
                  تسجيل الخروج
                </Group>
              </Anchor>
            </Group>

            {botUsername && (
              <Text size="xs" c="dimmed" ta="center">
                البوت: <Text component="span" dir="ltr">@{botUsername}</Text>
              </Text>
            )}
          </Stack>
        </Card>
      </motion.div>
    </div>
  );
}
