import { useLocaleStore } from '@/i18n/locale-store';

/** Tiny inline translator for the biometric / face / Telegram screens: Arabic (default) or English by the current locale. */
export function tr(ar: string, en: string): string {
  try { return useLocaleStore.getState().locale === 'en' ? en : ar; } catch { return ar; }
}
