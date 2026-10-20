'use client';

/**
 * ThemeSettingsPanel — v134n
 *
 * Modal panel for selecting theme identity (8 colors) + mode (light/dark/system).
 * Uses Mantine components (pure Mantine UI).
 *
 * Accessible from the settings page or via a floating button.
 */

import { useState } from 'react';
import {
  Modal, Stack, Group, Text, SegmentedControl, ColorSwatch,
  Box, ActionIcon, Tooltip, CheckIcon,
} from '@mantine/core';
import { useThemeStore } from '@/stores/theme-store';
import {
  THEME_IDENTITIES, THEME_MODES, IDENTITY_LABELS,
  type ThemeIdentity, type ThemeMode,
} from '@/lib/mantine-theme';
import { useTranslations } from '@/i18n/use-translations';

interface Props {
  opened: boolean;
  onClose: () => void;
}

export default function ThemeSettingsPanel({ opened, onClose }: Props) {
  const { t } = useTranslations();
  const { identity, mode, setBoth } = useThemeStore();
  const [selectedIdentity, setSelectedIdentity] = useState<ThemeIdentity>(identity);
  const [selectedMode, setSelectedMode] = useState<ThemeMode>(mode);

  const handleApply = () => {
    setBoth(selectedIdentity, selectedMode);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={
      <Text fw={600} size="lg">إعدادات المظهر</Text>
    } size="md" centered>
      <Stack gap="xl">
        {/* ─── Color Identity ─── */}
        <Box>
          <Text fw={500} size="sm" mb="xs">الهوية اللونية</Text>
          <Text size="xs" c="dimmed" mb="md">
            اختر اللون الأساسي للمنصة. سيتم تطبيقه على الأزرار والروابط والعناصر التفاعلية.
          </Text>
          <Group gap="sm">
            {THEME_IDENTITIES.map((id) => {
              const labels = IDENTITY_LABELS[id];
              const isSelected = selectedIdentity === id;
              return (
                <Tooltip key={id} label={labels.ar} position="bottom">
                  <button
                    type="button"
                    onClick={() => setSelectedIdentity(id)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      border: isSelected ? `3px solid ${labels.hex}` : '2px solid transparent',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? `0 0 0 2px white, 0 0 0 4px ${labels.hex}` : 'none',
                    }}
                  >
                    <Box
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 10,
                        backgroundColor: labels.hex,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSelected && <CheckIcon size={18} color="white" />}
                    </Box>
                  </button>
                </Tooltip>
              );
            })}
          </Group>
          <Text size="xs" c="dimmed" mt="sm">
            المحدد: <Text component="span" fw={500} c={IDENTITY_LABELS[selectedIdentity].hex}>
              {IDENTITY_LABELS[selectedIdentity].ar}
            </Text>
          </Text>
        </Box>

        {/* ─── Color Mode ─── */}
        <Box>
          <Text fw={500} size="sm" mb="xs">الوضع</Text>
          <Text size="xs" c="dimmed" mb="md">
            اختر الوضع الفاتح أو الداكن أو اتبع إعداد جهازك.
          </Text>
          <SegmentedControl
            value={selectedMode}
            onChange={(v) => setSelectedMode(v as ThemeMode)}
            data={[
              { label: '☀️ فاتح', value: 'light' },
              { label: '🌙 داكن', value: 'dark' },
              { label: '💻 حسب الجهاز', value: 'system' },
            ]}
            fullWidth
            size="md"
            radius="md"
          />
        </Box>

        {/* ─── Preview ─── */}
        <Box
          p="md"
          style={{
            borderRadius: 12,
            border: '1px solid var(--mantine-color-gray-3)',
            backgroundColor: selectedMode === 'dark' ? 'var(--mantine-color-dark-7)' : 'var(--mantine-color-gray-0)',
          }}
        >
          <Text size="xs" c="dimmed" mb="xs">معاينة</Text>
          <Group gap="sm">
            <Box
              style={{
                backgroundColor: IDENTITY_LABELS[selectedIdentity].hex,
                color: 'white',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              زر أساسي
            </Box>
            <Box
              style={{
                border: `1px solid ${IDENTITY_LABELS[selectedIdentity].hex}`,
                color: IDENTITY_LABELS[selectedIdentity].hex,
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              زر محدود
            </Box>
            <Text
              size="sm"
              c={selectedMode === 'dark' ? 'var(--mantine-color-dark-0)' : 'var(--mantine-color-gray-9)'}
            >
              <Text component="span" c={IDENTITY_LABELS[selectedIdentity].hex} fw={500}>
                رابط ملون
              </Text>
            </Text>
          </Group>
        </Box>

        {/* ─── Actions ─── */}
        <Group justify="flex-end" gap="sm">
          <ActionIcon
            variant="subtle"
            onClick={onClose}
            size="lg"
            style={{ width: 'auto', padding: '0 16px' }}
          >
            <Text size="sm">إلغاء</Text>
          </ActionIcon>
          <button
            type="button"
            onClick={handleApply}
            style={{
              backgroundColor: IDENTITY_LABELS[selectedIdentity].hex,
              color: 'white',
              border: 'none',
              padding: '8px 20px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            تطبيق
          </button>
        </Group>
      </Stack>
    </Modal>
  );
}
