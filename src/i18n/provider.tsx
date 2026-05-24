'use client';

import React, { useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from './locale-store';
import { initLocale } from './locale-store';
import { type Locale } from './config';

// Dynamic message loading
const messagesCache: Record<Locale, Record<string, string>> = {
  ar: {},
  en: {},
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
    return {};
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { locale } = useLocaleStore();
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  // Initialize locale on mount
  useEffect(() => {
    initLocale();
    setLoaded(true);
  }, []);

  // Load messages when locale changes
  useEffect(() => {
    if (!loaded) return;
    loadMessages(locale).then(setMessages);
  }, [locale, loaded]);

  // Set document direction
  useEffect(() => {
    if (!loaded) return;
    const direction = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, loaded]);

  if (!loaded || Object.keys(messages).length === 0) {
    return <>{children}</>;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
