'use client';

import { motion } from 'framer-motion';
import { WifiOff, RefreshCw, X, GraduationCap } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';

export default function OfflinePage() {
  const { t, isRTL } = useTranslations();

  const handleExit = () => {
    try {
      window.close();
    } catch {
      window.location.href = 'about:blank';
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-sky-100/40 dark:bg-sky-900/15 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 dark:bg-teal-900/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' as const }}
        className="relative z-10 w-full max-w-md mx-auto"
      >
        <div className="bg-white/90 dark:bg-card/90 backdrop-blur-sm rounded-3xl shadow-xl border border-sky-100/50 dark:border-border p-8 text-center">
          {/* Brand icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/30"
          >
            <GraduationCap className="h-7 w-7 text-white" />
          </motion.div>

          {/* Offline icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-sky-50 ring-4 ring-sky-100/50"
          >
            <WifiOff className="h-10 w-10 text-sky-700" />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xl font-bold text-gray-900 dark:text-foreground mb-2"
          >
            {t('offline.noConnection')}
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-gray-500 dark:text-muted-foreground mb-6 leading-relaxed"
          >
            {t('offline.noConnectionDesc')}
          </motion.p>

          {/* Action buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 active:from-sky-900 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              {t('offline.retry')}
            </button>

            <button
              onClick={handleExit}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white dark:bg-card border border-red-200 dark:border-red-900/60 px-6 py-2.5 text-sm font-semibold text-red-600 dark:text-red-500 shadow-sm hover:bg-red-50 dark:hover:bg-red-900/25 active:bg-red-100 dark:active:bg-red-900/20 transition-all duration-200 w-full sm:w-auto"
            >
              <X className="h-4 w-4" />
              {t('offline.exit')}
            </button>
          </motion.div>
        </div>

        {/* Footer branding */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-center text-xs text-gray-400 dark:text-muted-foreground mt-4"
        >
          {t('offline.branding')}
        </motion.p>
      </motion.div>
    </div>
  );
}
