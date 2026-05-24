import { create } from 'zustand';
import { type Locale, defaultLocale, getInitialLocale, setStoredLocale, getLocaleDirection } from './config';

interface LocaleState {
  locale: Locale;
  direction: 'rtl' | 'ltr';
  setLocale: (locale: Locale) => void;
  isRTL: () => boolean;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: defaultLocale,
  direction: getLocaleDirection(defaultLocale),
  setLocale: (locale: Locale) => {
    setStoredLocale(locale);
    const direction = getLocaleDirection(locale);
    // Update document attributes
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = direction;
    }
    set({ locale, direction });
  },
  isRTL: () => get().direction === 'rtl',
}));

// Initialize locale from storage on client side
export function initLocale() {
  if (typeof window === 'undefined') return;
  const locale = getInitialLocale();
  const direction = getLocaleDirection(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
  useLocaleStore.setState({ locale, direction });
}
