export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ar';

export const localeNames: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
};

export const localeDirections: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
};

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

export function getLocaleDirection(locale: Locale): 'rtl' | 'ltr' {
  return localeDirections[locale];
}

const LOCALE_STORAGE_KEY = 'attendo-locale';

export function getStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) return null;

    // Try the raw value first (e.g. "en")
    if (isValidLocale(raw)) return raw;

    // Handle JSON-stringified values (e.g. '"en"') from older versions
    // that may have stored the locale with JSON.stringify
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' && isValidLocale(parsed)) {
        // Fix the stored value so future reads don't need JSON.parse
        localStorage.setItem(LOCALE_STORAGE_KEY, parsed);
        return parsed;
      }
    } catch {
      // Not valid JSON, ignore
    }
  } catch {}
  return null;
}

export function setStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {}
}

export function detectBrowserLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  try {
    const browserLang = navigator.language.split('-')[0];
    if (isValidLocale(browserLang)) return browserLang;
  } catch {}
  return defaultLocale;
}

export function getInitialLocale(): Locale {
  const stored = getStoredLocale();
  if (stored) return stored;
  return detectBrowserLocale();
}
