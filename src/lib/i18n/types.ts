// ─── i18n Types ───
// Defines the structure for translation dictionaries

export type Locale = 'ar' | 'en';

export interface LocaleConfig {
  code: Locale;
  name: string;
  nativeName: string;
  dir: 'rtl' | 'ltr';
  fontFamily: string;
}

export const LOCALES: Record<Locale, LocaleConfig> = {
  ar: {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
    fontFamily: 'Noto Sans SC, Noto Sans Arabic, sans-serif',
  },
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    dir: 'ltr',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
};

export const DEFAULT_LOCALE: Locale = 'ar';

// ─── Translation dictionary structure ───
// Each key maps to a nested object of strings
// This allows t('common.save') to resolve to the correct string

export type TranslationValue = string | { [key: string]: TranslationValue };
export type TranslationDict = { [key: string]: TranslationValue };
