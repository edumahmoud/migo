'use client';

import React, { useEffect } from 'react';
import { useLocaleStore } from './locale-store';
import { initLocale } from './locale-store';

// DirectionProvider ensures the document dir/lang attributes stay in sync
// with the locale store, and provides a data attribute for CSS selectors
export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const { direction, locale } = useLocaleStore();

  // Initialize locale on mount
  useEffect(() => {
    initLocale();
  }, []);

  // Keep document attributes in sync
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
