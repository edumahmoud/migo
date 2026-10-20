'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Power, PowerOff, RefreshCw, Calendar } from 'lucide-react';
import {
  Card, Text, TextInput, Button, Badge, Stack, Group, Box, Select, Grid,
} from '@mantine/core';
import { toast } from 'sonner';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

interface SubscriptionPlan {
  id: string;
  subject_id: string;
  period_type: 'monthly' | 'term' | 'yearly' | 'custom';
  period_label: string;
  duration_days: number;
  price: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface Props {
  subjectId: string;
  subjectName: string;
  defaultPrice: number;
  currency: string;
}

const PERIOD_LABELS: Record<string, string> = {
  monthly: 'شهري',
  term: 'ترم',
  yearly: 'سنوي',
  custom: 'مخصص',
};

const PERIOD_DURATIONS: Record<string, number> = {
  monthly: 30,
  term: 120,
  yearly: 365,
  custom: 30,
};

export default function SubscriptionPlansSection({ subjectId, subjectName, defaultPrice, currency }: Props) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPlan, setNewPlan] = useState({
    period_type: 'monthly' as 'monthly' | 'term' | 'yearly' | 'custom',
    period_label: '',
    duration_days: 30,
    price: defaultPrice,
    currency,
  });
  const { confirmDialog, confirm } = useConfirmDialog();

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans`, {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setPlans(json.data ?? []);
      } else {
        toast.error(json.error || 'فشل تحميل الخطط');
      }
    } catch {
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [subjectId]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const addPlan = async () => {
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify(newPlan),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إضافة خطة الاشتراك');
        setShowAddForm(false);
        await fetchPlans();
      } else {
        toast.error(json.error || 'فشل الإضافة');
      }
    } catch {
      toast.error('حدث خطأ');
    }
  };

  const togglePlan = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getCachedAuthHeaders()) },
        body: JSON.stringify({ is_active: !currentActive }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(currentActive ? 'تم تعطيل الخطة' : 'تم تفعيل الخطة');
        await fetchPlans();
      } else {
        toast.error(json.error || 'فشل');
      }
    } catch {
      toast.error('حدث خطأ');
    }
  };

  const deletePlan = async (id: string) => {
    const ok = await confirm({
      title: 'حذف خطة الاشتراك',
      description: 'هل تريد حذف هذه الخطة نهائيًا؟ لا يمكن التراجع.',
      confirmLabel: 'حذف',
      cancelLabel: 'تراجع',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/teacher/subjects/${subjectId}/subscription-plans/${id}`, {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف الخطة');
        await fetchPlans();
      } else {
        toast.error(json.error || 'فشل الحذف');
      }
    } catch {
      toast.error('حدث خطأ');
    }
  };

  return (
    <Card shadow="xs" radius="md" p="lg">
      <Group justify="space-between" gap="sm" mb="md">
        <Group gap="sm">
          <Calendar size={18} style={{ color: 'var(--mantine-primary-color-filled)' }} />
          <Text fw={600} size="md">خطط الاشتراك — {subjectName}</Text>
        </Group>
        <Group gap="xs">
          <Button variant="subtle" size="sm" onClick={fetchPlans} loading={loading} aria-label="تحديث">
            {!loading && <RefreshCw size={14} />}
          </Button>
          <Button variant="outline" size="sm" leftSection={<Plus size={14} />} onClick={() => setShowAddForm(!showAddForm)}>
            إضافة خطة
          </Button>
        </Group>
      </Group>

      <Stack gap="md">
        {showAddForm && (
          <Box p="md" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8, backgroundColor: 'var(--mantine-color-gray-0)' }}>
            <Stack gap="sm">
              <Grid>
                <Grid.Col span={{ base: 12, xs: 6, sm: 3 }}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">نوع الفترة</Text>
                    <Select
                      value={newPlan.period_type}
                      onChange={(v) => {
                        const pt = (v || 'monthly') as typeof newPlan.period_type;
                        setNewPlan({ ...newPlan, period_type: pt, duration_days: PERIOD_DURATIONS[pt] || 30 });
                      }}
                      data={[
                        { value: 'monthly', label: 'شهري' },
                        { value: 'term', label: 'ترم' },
                        { value: 'yearly', label: 'سنوي' },
                        { value: 'custom', label: 'مخصص' },
                      ]}
                      size="sm"
                    />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 3 }}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">المدة (أيام)</Text>
                    <TextInput
                      type="number"
                      value={String(newPlan.duration_days)}
                      onChange={(e) => setNewPlan({ ...newPlan, duration_days: Number(e.target.value) })}
                      size="sm"
                    />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 3 }}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">السعر</Text>
                    <TextInput
                      type="number"
                      step="0.01"
                      value={String(newPlan.price)}
                      onChange={(e) => setNewPlan({ ...newPlan, price: Number(e.target.value) })}
                      size="sm"
                    />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 3 }}>
                  <Stack gap={4}>
                    <Text size="xs" c="dimmed">العملة</Text>
                    <TextInput
                      value={newPlan.currency}
                      onChange={(e) => setNewPlan({ ...newPlan, currency: e.target.value })}
                      size="sm"
                    />
                  </Stack>
                </Grid.Col>
              </Grid>
              {newPlan.period_type === 'custom' && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">تسمية مخصصة</Text>
                  <TextInput
                    value={newPlan.period_label}
                    onChange={(e) => setNewPlan({ ...newPlan, period_label: e.target.value })}
                    placeholder="مثال: ترم أول 2025"
                    size="sm"
                  />
                </Stack>
              )}
              <Group gap="sm">
                <Button size="sm" onClick={addPlan}>حفظ الخطة</Button>
                <Button size="sm" variant="subtle" onClick={() => setShowAddForm(false)}>إلغاء</Button>
              </Group>
            </Stack>
          </Box>
        )}

        {plans.length === 0 && !showAddForm ? (
          <Text size="sm" c="dimmed" ta="center" py={32}>
            لا توجد خطط اشتراك بعد. اضغط «إضافة خطة» لإنشاء خطة جديدة.
          </Text>
        ) : (
          <Stack gap="xs">
            {plans.map((plan) => (
              <Group
                key={plan.id}
                justify="space-between"
                gap="sm"
                p="sm"
                style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}
              >
                <Stack gap={2}>
                  <Group gap="sm">
                    <Text fw={500} size="sm">{PERIOD_LABELS[plan.period_type] || plan.period_type}</Text>
                    {plan.period_label && <Text size="xs" c="dimmed">— {plan.period_label}</Text>}
                    <Badge variant={plan.is_active ? 'filled' : 'light'} color={plan.is_active ? 'green' : 'gray'} size="sm">
                      {plan.is_active ? 'مفعّل' : 'معطّل'}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {plan.duration_days} يوم — {Number(plan.price).toFixed(2)} {plan.currency}
                  </Text>
                </Stack>
                <Group gap="xs">
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => togglePlan(plan.id, plan.is_active)}
                    title={plan.is_active ? 'تعطيل' : 'تفعيل'}
                  >
                    {plan.is_active
                      ? <Power size={14} style={{ color: 'var(--mantine-color-green-6)' }} />
                      : <PowerOff size={14} />}
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    color="red"
                    onClick={() => deletePlan(plan.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
      {confirmDialog}
    </Card>
  );
}
