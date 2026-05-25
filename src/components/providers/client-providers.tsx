'use client';

import React from 'react';
import { I18nBridgeProvider } from './i18n-bridge';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nBridgeProvider>
      {children}
    </I18nBridgeProvider>
  );
}
