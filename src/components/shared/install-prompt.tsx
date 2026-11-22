'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export default function InstallPrompt() {
  const { t, direction } = useTranslations();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Listen for the beforeinstallprompt event
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      // Show prompt after a short delay (don't annoy user immediately)
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed) {
        timer = setTimeout(() => setShowPrompt(true), 5000);
      } else {
        // Show again after 3 days
        const dismissedAt = parseInt(dismissed, 10);
        if (Date.now() - dismissedAt > 3 * 24 * 60 * 60 * 1000) {
          timer = setTimeout(() => setShowPrompt(true), 5000);
        }
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Listen for successful install
    const handleInstalled = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setDeferredPrompt(null);
      localStorage.removeItem('pwa-install-dismissed');
    };
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', handleInstalled);
      clearTimeout(timer);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
      }
    } catch (err) {
      console.error('[PWA] Install prompt error:', err);
    }

    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  // Don't render if installed or no prompt available
  if (isInstalled || !deferredPrompt) return null;

  return (
    <AnimatePresence>
      {showPrompt && (
        <motion.div
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80, pointerEvents: 'none' as const }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] end-4 z-50 flex items-center overflow-hidden rounded-full border border-sky-200 bg-white shadow-lg sm:bottom-6 sm:end-6"
          dir={direction}
        >
          <button
            type="button"
            onClick={handleInstall}
            className="flex min-h-11 items-center gap-2 bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('install.button')}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-11 w-11 items-center justify-center text-slate-500 transition-colors hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-sky-700"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
