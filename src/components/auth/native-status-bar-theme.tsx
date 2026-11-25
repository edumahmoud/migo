'use client';

import { useEffect } from 'react';

type NativeCall = (plugin: string, method: string, options?: unknown) => Promise<unknown>;

/**
 * Inside the Android app, tint the status bar to match the auth header band
 * (otherwise a white strip shows above it) and restore white on leave.
 * No-op in browsers or if the native StatusBar plugin is unavailable.
 */
export default function NativeStatusBarTheme({ color = '#0d9488' }: { color?: string }) {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { nativePromise?: NativeCall } }).Capacitor;
    const call = cap?.nativePromise;
    if (!call) return;
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    if (!isMobile) return;
    call('StatusBar', 'setBackgroundColor', { color }).catch(() => {});
    call('StatusBar', 'setStyle', { style: 'DARK' }).catch(() => {});
    return () => {
      call('StatusBar', 'setBackgroundColor', { color: '#ffffff' }).catch(() => {});
      call('StatusBar', 'setStyle', { style: 'LIGHT' }).catch(() => {});
    };
  }, [color]);
  return null;
}
