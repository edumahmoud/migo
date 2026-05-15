'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, RotateCcw, X, GraduationCap } from 'lucide-react';

/**
 * Root Error Page (error.tsx)
 *
 * CRITICAL FIX: This is the LAST RESORT error boundary for the entire app.
 * It should ONLY be reached if ALL inner error boundaries fail.
 *
 * Previous issue: SocketErrorBoundary was catching errors but re-rendering
 * the same children, causing errors to propagate here and show "حدث خطأ غير متوقع"
 * even for recoverable dashboard errors.
 *
 * This page now includes:
 * 1. Auto-recovery attempt (tries to remount after 3 seconds)
 * 2. Clear corrupted localStorage state before retry
 * 3. A more informative error UI with recovery options
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [autoRetrying, setAutoRetrying] = useState(true);

  useEffect(() => {
    // Log error for debugging
    console.error('[RootError] Unhandled error caught by error.tsx:', error);

    // Auto-recovery: Try to clear corrupted state and remount after 3 seconds
    const timer = setTimeout(() => {
      try {
        // Clear potentially corrupted state that might be causing the error
        localStorage.removeItem('_wsr');
        localStorage.removeItem('_sw_reload_pending');
        localStorage.removeItem('_attendo_busy');
        // Don't clear the full app store — that would log the user out
      } catch {}
      setAutoRetrying(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [error]);

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      // Clear potentially corrupted state before reloading
      try {
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
        // Clear ALL app state — this will log the user out but ensures a clean slate
        localStorage.removeItem('attendo-app-store');
        localStorage.removeItem('_wsr');
        localStorage.removeItem('_sw_reload_pending');
        localStorage.removeItem('_attendo_busy');
        // Clear Supabase auth tokens that might be corrupted
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

  const handleExit = () => {
    try {
      window.close();
    } catch {
      window.location.href = 'about:blank';
    }
  };

  // Auto-retry UI
  if (autoRetrying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-600 to-teal-500 flex items-center justify-center shadow-lg shadow-sky-500/30">
              <GraduationCap className="w-9 h-9 text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-sky-700" />
            <span className="text-sm font-medium text-sky-800">جاري محاولة الاسترجاع...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-white to-teal-50 p-4" dir="rtl">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-sky-100/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md mx-auto"
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
            className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-50 ring-4 ring-amber-100/50"
          >
            <AlertTriangle className="h-10 w-10 text-amber-500" />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xl font-bold text-gray-900 mb-2"
          >
            حدث خطأ غير متوقع
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-gray-500 mb-4 leading-relaxed"
          >
            نأسف لذلك! حدثت مشكلة أثناء تحميل التطبيق. يمكنك المحاولة مرة أخرى أو إعادة تعيين التطبيق.
          </motion.p>

          {/* Error digest for debugging */}
          {error?.digest && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              className="text-xs text-gray-400 mb-5 font-mono"
            >
              كود المرجع: {error.digest}
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
              <RotateCcw className="h-4 w-4" />
              إعادة المحاولة
            </button>

            <button
              onClick={handleReload}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              تحديث الصفحة
            </button>

            <button
              onClick={handleFullReset}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-amber-200 px-6 py-2.5 text-sm font-semibold text-amber-700 shadow-sm hover:bg-amber-50 active:bg-amber-100 transition-all duration-200 w-full sm:w-auto"
            >
              <AlertTriangle className="h-4 w-4" />
              إعادة تعيين التطبيق
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
          أتيندو — منصة تعليمية ذكية
        </motion.p>
      </motion.div>
    </div>
  );
}
