'use client';

import { useEffect, useState, useCallback } from 'react';
import { Ban, Power, Clock, AlertCircle } from 'lucide-react';
import {
  Modal, Text, TextInput, Textarea, Button, Stack, Group, Box, Center, Loader,
  Checkbox, Alert, Grid,
} from '@mantine/core';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';

interface CurrentSuspension {
  id: string;
  reason: string | null;
  suspended_at: string;
  expires_at: string | null;
}

interface Props {
  open: boolean;
  studentId: string | null;
  studentName: string;
  subjectId: string;
  subjectName: string;
  onClose: () => void;
  onChanged?: () => void;
}

const DURATION_PRESETS: Array<{ label: string; hours: number | null }> = [
  { label: 'ساعة', hours: 1 },
  { label: 'يوم', hours: 24 },
  { label: 'أسبوع', hours: 24 * 7 },
  { label: 'شهر', hours: 24 * 30 },
  { label: 'غير محدد', hours: null },
];

export default function StudentSuspendDialog({
  open, studentId, studentName, subjectId, subjectName, onClose, onChanged,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState<CurrentSuspension | null>(null);
  const [durationHours, setDurationHours] = useState<number | null>(24);
  const [customHours, setCustomHours] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [reason, setReason] = useState('');

  const fetchCurrent = useCallback(async () => {
    if (!studentId || !subjectId) return;
    setLoading(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('student_suspensions')
        .select('id, reason, suspended_at, expires_at, is_active')
        .eq('student_id', studentId)
        .eq('subject_id', subjectId)
        .eq('scope', 'course')
        .eq('is_active', true)
        .order('suspended_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const row = data as { is_active: boolean; expires_at: string | null } | null;
      const isActive = !!row && row.is_active && (row.expires_at === null || row.expires_at > nowIso);
      setCurrent(isActive ? (row as unknown as CurrentSuspension) : null);
    } catch (err) {
      console.error('[StudentSuspendDialog] fetchCurrent error:', err);
      setCurrent(null);
    } finally {
      setLoading(false);
    }
  }, [studentId, subjectId]);

  useEffect(() => {
    if (open && studentId && subjectId) {
      fetchCurrent();
      setDurationHours(24);
      setCustomHours('');
      setUseCustom(false);
      setReason('');
    }
  }, [open, studentId, subjectId, fetchCurrent]);

  const handleSuspend = async () => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const hours = useCustom ? Number(customHours) : durationHours;
      if (useCustom && (!hours || hours <= 0 || isNaN(hours))) {
        toast.error('أدخل عدد ساعات صحيح');
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/teacher/students/${studentId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({
          scope: 'course',
          subjectId,
          durationHours: useCustom ? hours : durationHours,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.error || 'فشل إيقاف الطالب'); return; }
      toast.success('تم إيقاف الطالب من هذا المقرر');
      await fetchCurrent();
      onChanged?.();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async () => {
    if (!studentId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ scope: 'course', subjectId }),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.error || 'فشل فك الإيقاف'); return; }
      toast.success('تم فك الإيقاف عن الطالب');
      await fetchCurrent();
      onChanged?.();
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={
        <Group gap="sm">
          <Ban size={20} style={{ color: 'var(--mantine-color-yellow-6)' }} />
          <Text fw={600}>إيقاف / تفعيل الطالب</Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          الطالب: <Text component="span" fw={500}>{studentName}</Text>
          <br />
          المقرر: <Text component="span" fw={500}>{subjectName}</Text>
        </Text>

        {loading ? (
          <Center py={32}>
            <Loader size="sm" />
          </Center>
        ) : current ? (
          <Stack gap="md">
            <Alert color="yellow" variant="light" icon={<AlertCircle size={16} />} radius="md">
              <Stack gap={4}>
                <Text size="sm" fw={600}>الطالب مُوقَف حالياً عن هذا المقرر</Text>
                <Text size="xs">تاريخ الإيقاف: {formatDate(current.suspended_at)}</Text>
                {current.expires_at && <Text size="xs">ينتهي تلقائياً: {formatDate(current.expires_at)}</Text>}
                {current.reason && <Text size="xs" mt={4}>السبب: {current.reason}</Text>}
              </Stack>
            </Alert>
            <Button onClick={handleActivate} loading={submitting} fullWidth color="green" leftSection={<Power size={16} />}>
              فك الإيقاف الآن
            </Button>
          </Stack>
        ) : (
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="sm" fw={500}>مدة الإيقاف</Text>
              <Grid>
                {DURATION_PRESETS.map((p) => {
                  const selected = !useCustom && durationHours === p.hours;
                  return (
                    <Grid.Col key={p.label} span={{ base: 6, xs: 2.4 }}>
                      <Button
                        variant={selected ? 'filled' : 'outline'}
                        color={selected ? 'yellow' : 'gray'}
                        size="xs"
                        fullWidth
                        onClick={() => { setUseCustom(false); setDurationHours(p.hours); }}
                      >
                        {p.label}
                      </Button>
                    </Grid.Col>
                  );
                })}
              </Grid>
            </Stack>

            <Group gap="sm" align="center">
              <Checkbox
                checked={useCustom}
                onChange={(e) => setUseCustom(e.currentTarget.checked)}
                size="sm"
              />
              <Text size="xs">مدة مخصصة (ساعات)</Text>
            </Group>
            {useCustom && (
              <TextInput
                type="number"
                min={1}
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                placeholder="مثال: 12"
                dir="ltr"
                size="sm"
              />
            )}

            <Stack gap="xs">
              <Text size="sm" fw={500}>السبب (اختياري)</Text>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: عدم حضور المحاضرات..."
                rows={2}
                maxLength={500}
                size="sm"
              />
            </Stack>

            <Button onClick={handleSuspend} loading={submitting} fullWidth color="yellow" leftSection={<Ban size={16} />}>
              إيقاف الطالب
            </Button>

            <Group gap="xs" align="flex-start">
              <Clock size={12} style={{ flexShrink: 0, marginTop: 2, color: 'var(--mantine-color-dimmed)' }} />
              <Text size="xs" c="dimmed">
                سيتعذر على الطالب الوصول إلى محتوى هذا المقرر طوال مدة الإيقاف.
                يمكنك فك الإيقاف في أي وقت، أو سيُرفع تلقائياً عند انتهاء المدة.
              </Text>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
