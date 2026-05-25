'use client';

// ─── COMPATIBILITY LAYER ───
// This file re-exports useI18n and useTranslation from the bridge provider
// so that all 50+ components importing from '@/lib/i18n/context' still work.
// The bridge provider connects to the NEW next-intl + locale-store system.

export { useI18n, useTranslation } from '@/components/providers/i18n-bridge';
export { I18nBridgeProvider as I18nProvider } from '@/components/providers/i18n-bridge';
