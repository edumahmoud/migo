'use client';

import { useEffect } from 'react';

type Bridge = { setStatusBarColor?: (hex: string, lightIcons: boolean) => void };

/**
 * Inside the Android app (build with the AttendoNative.setStatusBarColor bridge), tint the status bar
 * to match the auth header band and restore white on leave. No-op in browsers and older app builds.
 */
export default function NativeStatusBarTheme({ color = '#0d9488' }: { color?: string }) {
  useEffect(() => {
    const bridge = (window as unknown as { AttendoNative?: Bridge }).AttendoNative;
    if (!bridge || typeof bridge.setStatusBarColor !== 'function') return;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    try { bridge.setStatusBarColor(color, true); } catch { /* ignore */ }
    return () => {
      try { bridge.setStatusBarColor?.('#ffffff', false); } catch { /* ignore */ }
    };
  }, [color]);
  return null;
}
