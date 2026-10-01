'use client';

// P3-27 FIX: Removed framer-motion import. The error boundary is the
// LAST RESORT UI — if framer-motion itself crashed, the error page
// couldn't render. Now uses plain CSS animations via Tailwind.
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, GraduationCap } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t, direction } = useTranslations();
  const [autoRetrying, setAutoRetrying] = useState(true);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  useEffect(() => {
    console.error('[RootError] Unhandled error caught by error.tsx:', error);

    try {
      const supabaseKeys = Object.keys(localStorage).filter(k =>
        k.startsWith('sb-') && k.endsWith('-auth-token')
      );
      if (supabaseKeys.length > 0) {
        const sessionData = JSON.parse(localStorage.getItem(supabaseKeys[0]) || '');
        if (sessionData?.access_token || (Array.isArray(sessionData) && sessionData[0]?.access_token)) {
          setHasActiveSession(true);
        }
      }
    } catch {}

    const timer = setTimeout(() => {
      try {
        localStorage.removeItem('attendo-app-store');
        localStorage.removeItem('_wsr');
        localStorage.removeItem('_sw_reload_pending');
        localStorage.removeItem('_attendo_busy');
      } catch {}
      setAutoRetrying(false);
      reset();
    }, 3000);

    return () => clearTimeout(timer);
  }, [error, reset]);

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('attendo-app-store');
        localStorage.removeItem('_wsr');
        localStorage.removeItem('_sw_reload_pending');
        localStorage.removeItem('_attendo_busy');
      } catch {}
      window.location.reload();
    }
  };

  const handleFullReset = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('attendo-app-store');
        localStorage.removeItem('_wsr');
        localStorage.removeItem('_sw_reload_pending');
        localStorage.removeItem('_attendo_busy');
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
      } catch {}
      window.location.reload();
    }
  };

  if (autoRetrying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={direction}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <GraduationCap className="w-9 h-9 text-white" />
          </div>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">{t('errorBoundary.recoveringAuto')}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={direction}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-sky-100/40 dark:bg-sky-900/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 dark:bg-teal-900/20 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-white/90 dark:bg-card/90 backdrop-blur-sm rounded-3xl shadow-xl border border-sky-100/50 dark:border-border p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/30">
            <GraduationCap className="h-7 w-7 text-white" />
          </div>

          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-50 ring-4 ring-amber-100/50">
            <AlertTriangle className="h-10 w-10 text-amber-500" />
          </div>

          <h1 className="text-xl font-bold text-gray-900 dark:text-foreground mb-2">
            {t('errorBoundary.unexpectedError')}
          </h1>

          <p className="text-sm text-gray-500 dark:text-muted-foreground mb-4 leading-relaxed">
            {t('errorBoundary.unexpectedErrorDesc')}
          </p>

          {error?.digest && (
            <p className="text-xs text-gray-400 dark:text-muted-foreground mb-5 font-mono">
              {t('common.referenceCode')} {error.digest}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 active:from-sky-900 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
            >
              <RotateCcw className="h-4 w-4" />
              {t('common.retry')}
            </button>

            <button
              onClick={handleReload}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-card border border-gray-200 dark:border-border px-6 py-2.5 text-sm font-semibold text-gray-700 dark:text-foreground shadow-sm hover:bg-gray-50 dark:hover:bg-muted/50 active:bg-gray-100 dark:active:bg-muted transition-all duration-200 w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              {t('common.refreshPage')}
            </button>

            {hasActiveSession && (
              <button
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-teal-200 px-6 py-2.5 text-sm font-semibold text-teal-700 shadow-sm hover:bg-teal-50 active:bg-teal-100 transition-all duration-200 w-full sm:w-auto"
              >
                <GraduationCap className="h-4 w-4" />
                {t('common.returnToApp')}
              </button>
            )}

            <button
              onClick={handleFullReset}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-amber-200 px-6 py-2.5 text-sm font-semibold text-amber-700 shadow-sm hover:bg-amber-50 active:bg-amber-100 transition-all duration-200 w-full sm:w-auto"
            >
              <AlertTriangle className="h-4 w-4" />
              {t('common.resetApp')}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-muted-foreground mt-4">
          {t('errorBoundary.branding')}
        </p>
      </div>
    </div>
  );
}
