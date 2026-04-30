'use client';

import { motion } from 'framer-motion';
import { Database, AlertTriangle, RefreshCw, X, GraduationCap } from 'lucide-react';

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function getMissingEnvVars(): string[] {
  if (typeof window === 'undefined') return [];

  // NEXT_PUBLIC_ vars are available on the client
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  // SUPABASE_SERVICE_ROLE_KEY is server-only, so we can't check it on the client.
  // If the public vars are missing, we know configuration is incomplete.
  // We'll still show it in the list as informational.
  if (missing.length > 0) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY (متاح فقط على الخادم)');
  }

  return missing;
}

export default function SupabaseConfigError() {
  const missingVars = getMissingEnvVars();
  const hasMissingVars = missingVars.length > 0;

  const handleRetry = () => {
    window.location.reload();
  };

  const handleExit = () => {
    try {
      window.close();
    } catch {
      // Fallback: try to navigate away
      window.location.href = 'about:blank';
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4"
      dir="rtl"
    >
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
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30"
          >
            <GraduationCap className="h-8 w-8 text-white" />
          </motion.div>

          {/* Error icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-red-50 ring-4 ring-red-100/50"
          >
            <Database className="h-10 w-10 text-red-500" />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xl font-bold text-gray-900 mb-2"
          >
            خطأ في الاتصال بقاعدة البيانات
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-gray-500 mb-5 leading-relaxed"
          >
            لم يتمكن التطبيق من الاتصال بقاعدة البيانات. يرجى التحقق من إعدادات Supabase أو الاتصال بالإنترنت.
          </motion.p>

          {/* Missing env vars section */}
          {hasMissingVars && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-right"
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-sm font-bold text-amber-800">
                  متغيرات البيئة المفقودة
                </p>
              </div>
              <ul className="space-y-1.5 mr-6">
                {missingVars.map((varName) => (
                  <li key={varName} className="flex items-center gap-2 text-xs text-amber-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                    <code className="font-mono bg-amber-100/80 px-1.5 py-0.5 rounded text-amber-900">
                      {varName}
                    </code>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-600 mt-3 leading-relaxed">
                يرجى إضافة هذه المتغيرات في ملف <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded">.env.local</code> وإعادة تشغيل التطبيق.
              </p>
            </motion.div>
          )}

          {/* Connection issue note (when vars exist but still can't connect) */}
          {!hasMissingVars && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-right"
            >
              <p className="text-sm text-emerald-800 leading-relaxed">
                متغيرات البيئة مضبوطات، لكن يبدو أن هناك مشكلة في الاتصال بخادم Supabase. تحقق من اتصالك بالإنترنت أو صحة عنوان URL والمفتاح.
              </p>
            </motion.div>
          )}

          {/* Action buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <button
              onClick={handleRetry}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-700 hover:to-teal-700 active:from-emerald-800 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              إعادة المحاولة
            </button>

            <button
              onClick={handleExit}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 w-full sm:w-auto"
            >
              <X className="h-4 w-4" />
              الخروج
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
