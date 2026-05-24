'use client';

import React, { useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from './locale-store';
import { initLocale } from './locale-store';
import { type Locale, defaultLocale } from './config';

// Statically import default locale messages so they're available during SSR.
// This prevents the "Missing NextIntlClientProvider" crash during static prerendering.
import arMessages from './messages/ar.json';
import enMessages from './messages/en.json';

const staticMessages: Record<Locale, Record<string, string>> = {
  ar: arMessages as unknown as Record<string, string>,
  en: enMessages as unknown as Record<string, string>,
};

// Dynamic message loading (for cache invalidation if needed)
const messagesCache: Record<Locale, Record<string, string>> = {
  ar: staticMessages.ar,
  en: staticMessages.en,
};

async function loadMessages(locale: Locale): Promise<Record<string, string>> {
  if (Object.keys(messagesCache[locale]).length > 0) {
    return messagesCache[locale];
  }
  try {
    const mod = await import(`./messages/${locale}.json`);
    messagesCache[locale] = mod.default || mod;
    return messagesCache[locale];
  } catch (error) {
    console.error(`Failed to load messages for locale "${locale}":`, error);
    return staticMessages[locale];
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useLocaleStore();
  const [messages, setMessages] = useState<Record<string, string>>(staticMessages[defaultLocale]);
  const [loaded, setLoaded] = useState(false);

  // Initialize locale on mount
  useEffect(() => {
    initLocale();
    setLoaded(true);
  }, []);

  // Load messages when locale changes
  useEffect(() => {
    loadMessages(locale).then(setMessages);
  }, [locale]);

  // Set document direction
  useEffect(() => {
    if (!loaded) return;
    const direction = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, loaded]);

  // ALWAYS wrap with NextIntlClientProvider — even during SSR.
  // The default locale messages are statically imported above,
  // so the provider always has valid messages available.
  return (
    <NextIntlClientProvider locale={loaded ? locale : defaultLocale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
