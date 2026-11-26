'use client';

import { useEffect, useState } from 'react';

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<{ version?: string; build?: string }>;
}

/**
 * Small "version" line for the login page.
 * - Inside the Android app: the installed APK version (e.g. 0.4.16), read from the native shell.
 * - In a browser: nothing (hidden on the web).
 */
export default function AppVersionLabel() {
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cap = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor;
    if (!cap?.nativePromise) return;
    cap
      .nativePromise('App', 'getInfo')
      .then((info) => {
        if (!cancelled && info?.version) setAppVersion(info.version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The version line is shown only inside the mobile app; the web page shows nothing.
  if (!appVersion) return null;
  const text = `AttenDo v${appVersion}`;

  return (
    <p dir="ltr" className="text-center text-[11px] text-muted-foreground/70 select-text">
      {text}
    </p>
  );
}
