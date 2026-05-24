'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, X, GraduationCap } from 'lucide-react';

/**
 * Global Error Boundary — renders OUTSIDE the normal React tree
 * (has its own <html>/<body>), so it CANNOT use i18n context.
 * Instead, it reads the language from localStorage directly.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Error]', error);
  }, [error]);

  // Read language from localStorage (same key as Zustand persist)
  let lang = 'ar';
  let dir = 'rtl';
  try {
    const raw = localStorage.getItem('attendo-app-store');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.language === 'en') {
        lang = 'en';
        dir = 'ltr';
      }
    }
  } catch {}

  // Minimal inline translations (cannot import i18n context here)
  const strings: Record<string, Record<string, string>> = {
    ar: {
      critical: 'خطأ حرج في التطبيق',
      criticalDesc: 'حدث خطأ فادح يمنع تشغيل التطبيق. يرجى تحديث الصفحة أو المحاولة لاحقاً.',
      retry: 'إعادة المحاولة',
      refreshPage: 'تحديث الصفحة',
      exitApp: 'الخروج من التطبيق',
      brandTagline: 'أتيندو — منصة تعليمية ذكية',
      referenceCode: 'كود المرجع: {code}',
    },
    en: {
      critical: 'Critical Application Error',
      criticalDesc: 'A fatal error occurred that prevents the app from running. Please refresh the page or try again later.',
      retry: 'Retry',
      refreshPage: 'Refresh Page',
      exitApp: 'Exit App',
      brandTagline: 'Attendo — Smart Educational Platform',
      referenceCode: 'Reference code: {code}',
    },
  };

  const s = strings[lang] || strings.ar;

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

  const handleExit = () => {
    try {
      window.close();
    } catch {
      window.location.href = 'about:blank';
    }
  };

  return (
    <html lang={lang} dir={dir}>
      <body className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-sky-100/40 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' as const }}
          className="relative z-10 w-full max-w-md mx-auto"
          style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-sky-100/50 p-8 text-center">
            {/* Brand icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/30"
            >
              <GraduationCap className="h-7 w-7 text-white" />
            </motion.div>

            {/* Error icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
              className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-red-50 ring-4 ring-red-100/50"
            >
              <AlertTriangle className="h-10 w-10 text-red-500" />
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-xl font-bold text-gray-900 mb-2"
            >
              {s.critical}
            </motion.h1>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-sm text-gray-500 mb-4 leading-relaxed"
            >
              {s.criticalDesc}
            </motion.p>

            {/* Error digest */}
            {error?.digest && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.55 }}
                className="text-xs text-gray-400 mb-5 font-mono"
              >
                {s.referenceCode.replace('{code}', error.digest)}
              </motion.p>
            )}

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3"
            >
              <button
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 active:from-sky-900 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                {s.retry}
              </button>

              <button
                onClick={handleReload}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 w-full sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                {s.refreshPage}
              </button>

              <button
                onClick={handleExit}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-red-200 px-6 py-2.5 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-50 active:bg-red-100 transition-all duration-200 w-full sm:w-auto"
              >
                <X className="h-4 w-4" />
                {s.exitApp}
              </button>
            </motion.div>
          </div>

          {/* Footer branding */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-center text-xs text-gray-400 mt-4"
          >
            {s.brandTagline}
          </motion.p>
        </motion.div>
      </body>
    </html>
  );
}
