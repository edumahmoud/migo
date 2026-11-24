'use client';

import { Languages } from 'lucide-react';
import { useLocaleStore } from '@/i18n/locale-store';
import { useTranslations } from '@/i18n/use-translations';

/**
 * Language toggle for the public auth pages (login / register).
 * Switches between Arabic and English and persists the choice
 * via the locale store (localStorage).
 */
export default function AuthLanguageToggle() {
  const { locale, setLocale } = useLocaleStore();
  const { t } = useTranslations();
  const nextLocale = locale === 'ar' ? 'en' : 'ar';
  const label = nextLocale === 'en' ? 'English' : 'العربية';
  const ariaLabel = nextLocale === 'en' ? t('auth.switchToEnglish') : t('auth.switchToArabic');

  return (
    <button
      type="button"
      onClick={() => setLocale(nextLocale)}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-border bg-white/90 dark:bg-card/90 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-sky-400 hover:text-sky-700"
    >
      <Languages className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}
