'use client';

import { useCallback } from 'react';
import { useTranslations as useNextIntlTranslations } from 'next-intl';
import { useLocaleStore } from './locale-store';

// Re-export useTranslations from next-intl with our enhancements
export function useTranslations(namespace?: string) {
  const rawT = useNextIntlTranslations(namespace);
  const { locale, direction } = useLocaleStore();
  
  // Wrap the translation function to handle missing keys gracefully
  // In development: log a warning for missing keys
  // In production: return a fallback string instead of raw key paths
  //
  // CRITICAL: useCallback ensures `t` has a stable reference across renders.
  // Without this, any component that depends on `t` (e.g., in useCallback/useEffect)
  // would re-create its callback on every render, causing infinite loops
  // (e.g., the notes-tab fetchAllNotes infinite refresh bug).
  const t = useCallback((key: string, params?: Record<string, string | number | Date>): string => {
    const result = rawT(key, params);
    
    // next-intl returns the key path itself when a translation is missing
    // e.g., t('nonexistent.key') returns 'nonexistent.key'
    // We detect this by checking if the result equals the full key path
    const fullKey = namespace ? `${namespace}.${key}` : key;
    
    if (result === fullKey || result === key) {
      // Missing translation key detected
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[i18n] Missing translation key: "${fullKey}" (locale: ${locale})`);
      }
      // Return empty string in production to avoid showing raw keys to users
      // This is better than showing "auth.auth.restorePassword" which confuses users
      return '';
    }
    
    return result;
  }, [rawT, namespace, locale]);
  
  return {
    t,
    locale,
    direction,
    isRTL: direction === 'rtl',
    isLTR: direction === 'ltr',
  };
}

// Hook for just getting direction info without translations
export function useDirection() {
  const { direction, locale, isRTL } = useLocaleStore();
  return { direction, locale, isRTL, isLTR: !isRTL };
}
