'use client';

import React, { createContext, useContext, useCallback, useMemo, useEffect } from 'react';
import { type Locale, type LocaleConfig, LOCALES, DEFAULT_LOCALE, type TranslationDict, type TranslationValue } from './types';
import { ar } from './translations/ar';
import { en } from './translations/en';
import { useAppStore } from '@/stores/app-store';

// ─── i18n Context ───

interface I18nContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  config: LocaleConfig;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Translation dictionaries ───
const translations: Record<Locale, TranslationDict> = { ar, en };

// ─── Resolve a dot-separated key from a nested object ───
function resolve(obj: TranslationDict, path: string): string {
  const keys = path.split('.');
  let current: TranslationValue = obj;
  for (const key of keys) {
    if (typeof current === 'object' && current !== null && key in current) {
      current = current[key];
    } else {
      // Key not found — return the key itself as fallback
      return path;
    }
  }
  return typeof current === 'string' ? current : path;
}

// ─── Replace {param} placeholders in a string ───
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

// ─── Provider Component ───
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { language, setLanguage } = useAppStore();

  const locale = language || DEFAULT_LOCALE;
  const config = LOCALES[locale];
  const dir = config.dir;
  const isRTL = dir === 'rtl';

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = translations[locale] || translations[DEFAULT_LOCALE];
      const template = resolve(dict, key);
      // Fallback: if key not found in current locale, try default locale
      const value = template === key && locale !== DEFAULT_LOCALE
        ? resolve(translations[DEFAULT_LOCALE], key)
        : template;
      return interpolate(value, params);
    },
    [locale]
  );

  const setLocale = useCallback(
    (newLocale: Locale) => {
      setLanguage(newLocale);
    },
    [setLanguage]
  );

  // ─── Update document direction and lang attribute ───
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const html = document.documentElement;
    html.setAttribute('dir', dir);
    html.setAttribute('lang', locale);

    // Update body class for direction-specific styling
    document.body.classList.remove('rtl', 'ltr');
    document.body.classList.add(dir);

    // Set font family based on locale
    document.body.style.fontFamily = config.fontFamily;
  }, [dir, locale, config.fontFamily]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir, config, t, setLocale, isRTL }),
    [locale, dir, config, t, setLocale, isRTL]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ─── Fallback i18n value (used when no provider is available, e.g., SSR) ───
const fallbackI18n: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  dir: LOCALES[DEFAULT_LOCALE].dir,
  config: LOCALES[DEFAULT_LOCALE],
  t: (key: string) => key,
  setLocale: () => {},
  isRTL: true,
};

// ─── Hook ───
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Return fallback instead of throwing — allows SSR and components outside provider
    return fallbackI18n;
  }
  return ctx;
}

// ─── Convenience hook: just the t function ───
export function useTranslation() {
  const { t } = useI18n();
  return { t };
}
