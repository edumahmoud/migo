'use client';

import React, { useEffect } from 'react';
import { useLocaleStore } from './locale-store';

// DirectionProvider ensures the document dir/lang attributes stay in sync
// with the locale store, and provides a data attribute for CSS selectors.
//
// NOTE: Locale initialization (initLocale) is handled by I18nProvider,
// which wraps this component. We do NOT call initLocale() here to avoid
// a duplicate state update that could cause a direction flash.
export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const { direction, locale } = useLocaleStore();

  // Keep document attributes in sync with the store
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    // Set data attribute for CSS selectors
    document.documentElement.setAttribute('data-dir', direction);
    document.documentElement.setAttribute('data-locale', locale);
  }, [direction, locale]);

  return <>{children}</>;
}
