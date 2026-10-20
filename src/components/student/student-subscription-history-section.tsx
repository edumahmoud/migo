'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Search, BookOpen, Filter, Copy } from 'lucide-react';
import {
  Card, Text, TextInput, Button, Badge, Stack, Group, Box, Center, Loader,
  SegmentedControl,
} from '@mantine/core';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type { UserProfile } from '@/lib/types';

interface OrderHistory {
  id: string;
  subject_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_order_ref: string | null;
  checkout_session_id: string | null;
  created_at: string;
  paid_at: string | null;
  activated_at: string | null;
  plan_duration_days?: number | null;
  subject: { id: string; name: string; price: number } | null;
}

interface StudentSubscriptionHistorySectionProps {
  profile: UserProfile;
}

export default function StudentSubscriptionHistorySection({ profile }: StudentSubscriptionHistorySectionProps) {
  const { t } = useTranslations();
  const [orders, setOrders] = useState<OrderHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid' | 'cancelled' | 'failed'>('all');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { getCachedAuthHeaders } = await import('@/lib/client-auth');
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/student/orders/history', { headers });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'تعذّر جلب سجل الاشتراكات');
        return;
      }
      const ordersData = json.orders ?? [];
      setOrders(ordersData.length === 0 ? [] : (ordersData as OrderHistory[]));
    } catch (err) {
      console.error('[sub-history] fetch failed:', err);
      toast.error('حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const orderRef = (o.provider_order_ref ?? '').toLowerCase();
      const orderId = (o.id ?? '').toLowerCase().slice(0, 8);
      const subjectName = (o.subject?.name ?? '').toLowerCase();
      if (!orderRef.includes(q) && !orderId.includes(q) && !subjectName.includes(q)) return false;
    }
    return true;
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`تم نسخ الكود: ${code}`);
    } catch {
      toast.error('تعذّر نسخ الكود');
    }
  };

  const statusBadgeColor = (status: string): 'green' | 'yellow' | 'red' | 'gray' | 'blue' => {
    switch (status) {
      case 'paid': return 'green';
      case 'pending': return 'yellow';
      case 'cancelled': return 'red';
      case 'failed': return 'red';
      case 'refunded': return 'gray';
      default: return 'gray';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'مدفوع';
      case 'pending': return 'معلّق';
      case 'cancelled': return 'ملغي';
      case 'failed': return 'فشل';
      case 'refunded': return 'مسترجع';
      default: return status;
    }
  };

  return (
    <div className="space-y-4 p-3 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <Group gap="sm" align="flex-start" wrap="wrap">
        <Box
          style={{
            width: 40, height: 40, borderRadius: 12,
            backgroundColor: 'var(--mantine-primary-color-filled)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <History size={20} color="white" />
        </Box>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="xl" fw={700}>سجل الاشتراكات</Text>
          <Text size="sm" c="dimmed">
            كل عمليات الاشتراك اللي عملتها — لكل عملية كود مميز تقدر تستخدمه للبحث والمتابعة.
          </Text>
        </Stack>
        <Button variant="outline" size="sm" onClick={fetchOrders} loading={loading} leftSection={<RefreshCw size={14} />}>
          تحديث
        </Button>
      </Group>

      {/* Search + filter */}
      <Card shadow="xs" radius="md" p="sm">
        <Stack gap="sm">
          <Group gap="sm" wrap="wrap">
            <TextInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث برقم العملية أو اسم المقرر..."
              leftSection={<Search size={16} />}
              style={{ flex: 1, minWidth: 200 }}
              size="sm"
            />
            <Group gap="xs">
              <Filter size={16} />
              <SegmentedControl
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                data={[
                  { label: 'الكل', value: 'all' },
                  { label: 'معلّق', value: 'pending' },
                  { label: 'مدفوع', value: 'paid' },
                  { label: 'ملغي', value: 'cancelled' },
                  { label: 'فشل', value: 'failed' },
                ]}
                size="xs"
                radius="md"
              />
            </Group>
          </Group>
          <Text size="xs" c="dimmed">
            عدد النتائج: {filteredOrders.length} من {orders.length}
          </Text>
        </Stack>
      </Card>

      {/* Orders list */}
      <Card shadow="xs" radius="md" p={0}>
        <Box p="sm" pb="xs">
          <Text fw={600} size="sm">العمليات</Text>
        </Box>
        {loading ? (
          <Center py={48}>
            <Loader size="sm" />
          </Center>
        ) : filteredOrders.length === 0 ? (
          <Center py={48}>
            <Stack gap="xs" align="center">
              <History size={48} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm" c="dimmed">
                {orders.length === 0 ? 'لا يوجد عمليات اشتراك في سجلك حتى الآن.' : 'لا توجد نتائج تطابق بحثك.'}
              </Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap={0}>
            {filteredOrders.map((o) => {
              const INTERNAL_PREFIXES = ['order_', 'free_', 'manual_', 'force_', 'backfill_', 'verify_', 'gateway_', 'pi_test_', 'pi_live_'];
              const rawRef = o.provider_order_ref;
              const displayOrderId = rawRef && !INTERNAL_PREFIXES.some(p => rawRef.startsWith(p))
                ? rawRef
                : (o.id.length >= 8 ? o.id.slice(0, 8).toUpperCase() : o.id);
              const subjectPrice = Number(o.subject?.price ?? 0);
              const totalPaid = Number(o.amount ?? 0);
              const durationDays = o.plan_duration_days ?? 30;
              const durationLabel = durationDays >= 365 ? 'سنوي' :
                durationDays >= 120 ? 'ترم' :
                durationDays >= 60 ? 'فصلين' :
                durationDays === 30 ? 'شهري' :
                `${durationDays} يوم`;

              return (
                <Box
                  key={o.id}
                  p="sm"
                  style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                >
                  <Group justify="space-between" gap="sm" wrap="wrap" mb="xs">
                    <Group gap="sm">
                      <BookOpen size={16} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
                      <Text fw={500} size="sm" truncate>{o.subject?.name ?? 'مقرر غير معروف'}</Text>
                    </Group>
                    <Badge color={statusBadgeColor(o.status)} variant="light" size="sm">
                      {statusLabel(o.status)}
                    </Badge>
                  </Group>
                  <Group gap="xl" wrap="wrap">
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">التاريخ</Text>
                      <Text size="xs" fw={500} dir="ltr">
                        {new Date(o.created_at).toLocaleDateString('ar-EG')}{' '}
                        <Text component="span" c="dimmed">
                          {new Date(o.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </Text>
                      </Text>
                    </Stack>
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">بوابة الدفع</Text>
                      <Text size="xs" fw={500}>Paymob</Text>
                    </Stack>
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">رقم العملية</Text>
                      <button
                        type="button"
                        onClick={() => copyCode(displayOrderId)}
                        style={{
                          fontFamily: 'monospace',
                          color: 'var(--mantine-primary-color-filled)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                        title="اضغط للنسخ"
                      >
                        <Group gap={4}>
                          {displayOrderId}
                          <Copy size={10} />
                        </Group>
                      </button>
                    </Stack>
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">ثمن المقرر</Text>
                      <Text size="xs" fw={500} ff="mono">{subjectPrice.toFixed(2)} {o.currency}</Text>
                    </Stack>
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">إجمالي المدفوع</Text>
                      <Text size="xs" fw={700} ff="mono" c="green.7">{totalPaid.toFixed(2)} {o.currency}</Text>
                    </Stack>
                    {o.checkout_session_id && (
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">نوع الدفعة</Text>
                        <Text size="xs" fw={500}>دفعة موحدة</Text>
                      </Stack>
                    )}
                    <Stack gap={2}>
                      <Text size="xs" c="dimmed">مدة الاشتراك</Text>
                      <Text size="xs" fw={500}>{durationLabel}</Text>
                    </Stack>
                  </Group>
                </Box>
              );
            })}
          </Stack>
        )}
      </Card>
    </div>
  );
}
