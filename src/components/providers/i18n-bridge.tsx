'use client';

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useTranslations } from '@/i18n/use-translations';
import { useLocaleStore } from '@/i18n/locale-store';
import { type Locale } from '@/i18n/config';

/**
 * I18nBridgeProvider — bridges the OLD useI18n() API to the NEW next-intl system.
 *
 * The old system (lib/i18n/context.tsx) used a custom Context with useI18n().
 * The new system (i18n/) uses next-intl with useLocaleStore.
 *
 * This provider wraps the old API so 50+ components using useI18n() still work,
 * while actually delegating to the new next-intl + locale-store system.
 */

interface I18nContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Fallback for SSR / when no provider is available
const fallbackI18n: I18nContextValue = {
  locale: 'ar' as Locale,
  dir: 'rtl',
  t: (key: string, params?: Record<string, string | number>) => {
    if (params) {
      return key.replace(/\{(\w+)\}/g, (_, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`
      );
    }
    return key;
  },
  setLocale: () => {},
  isRTL: true,
};

export function I18nBridgeProvider({ children }: { children: React.ReactNode }) {
  const { t: nextIntlT, locale, direction, isRTL } = useTranslations();
  const { setLocale } = useLocaleStore();
  const dir = direction;

  // Bridge the old t() API to next-intl's t()
  // The old system uses (key, params) while next-intl uses t(key, {param: value})
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      try {
        // Try next-intl's t function first
        const result = nextIntlT(key);
        // If the key was found (result differs from key), interpolate params manually
        if (result !== key && params) {
          return result.replace(/\{(\w+)\}/g, (_, k) =>
            params[k] !== undefined ? String(params[k]) : `{${k}}`
          );
        }
        return result;
      } catch {
        // Key not found in next-intl, return key with interpolated params
        if (params) {
          return key.replace(/\{(\w+)\}/g, (_, k) =>
            params[k] !== undefined ? String(params[k]) : `{${k}}`
          );
        }
        return key;
      }
    },
    [nextIntlT]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir, t, setLocale, isRTL }),
    [locale, dir, t, setLocale, isRTL]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return fallbackI18n;
  }
  return ctx;
}

export function useTranslation() {
  const { t } = useI18n();
  return { t };
}
