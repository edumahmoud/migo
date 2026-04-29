'use client';

import { motion } from 'framer-motion';
import { WifiOff, RefreshCw, X, GraduationCap } from 'lucide-react';

export default function OfflinePage() {
  const handleExit = () => {
    try {
      window.close();
    } catch {
      window.location.href = 'about:blank';
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4" dir="rtl">
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

          {/* Offline icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-50 ring-4 ring-emerald-100/50"
          >
            <WifiOff className="h-10 w-10 text-emerald-600" />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xl font-bold text-gray-900 mb-2"
          >
            لا يوجد اتصال
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-gray-500 mb-6 leading-relaxed"
          >
            يبدو أنك غير متصل بالإنترنت. تحقق من اتصالك وحاول مرة أخرى.
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-700 hover:to-teal-700 active:from-emerald-800 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              إعادة المحاولة
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
    </div>
  );
}
