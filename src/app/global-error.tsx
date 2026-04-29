'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, X, GraduationCap } from 'lucide-react';

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

  const handleReload = () => {
    if (typeof window !== 'undefined') {
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
    <html lang="ar" dir="rtl">
      <body className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-100/40 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-100/40 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-md mx-auto"
          style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
        >
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-xl border border-emerald-100/50 p-8 text-center">
            {/* Brand icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30"
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
              خطأ حرج في التطبيق
            </motion.h1>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-sm text-gray-500 mb-4 leading-relaxed"
            >
              حدث خطأ فادح يمنع تشغيل التطبيق. يرجى تحديث الصفحة أو المحاولة لاحقاً.
            </motion.p>

            {/* Error digest */}
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
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-700 hover:to-teal-700 active:from-emerald-800 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
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
                onClick={handleExit}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-red-200 px-6 py-2.5 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-50 active:bg-red-100 transition-all duration-200 w-full sm:w-auto"
              >
                <X className="h-4 w-4" />
                الخروج من التطبيق
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
      </body>
    </html>
  );
}
