'use client';

import { useTranslations as useNextIntlTranslations } from 'next-intl';
import { useLocaleStore } from './locale-store';

// Re-export useTranslations from next-intl with our enhancements
export function useTranslations(namespace?: string) {
  const t = useNextIntlTranslations(namespace);
  const { locale, direction } = useLocaleStore();
  
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
