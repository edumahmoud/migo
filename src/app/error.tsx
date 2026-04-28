'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error for debugging
    console.error('[App Error]', error);
  }, [error]);

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="text-center max-w-sm mx-auto"
      >
        {/* Icon */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-50 mb-6 ring-4 ring-amber-100/50">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold text-foreground mb-2">
          حدث خطأ غير متوقع
        </h1>

        {/* Description */}
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          نأسف لذلك! يبدو أن هناك مشكلة في تحميل الصفحة. يمكنك المحاولة مرة أخرى أو تحديث الصفحة.
        </p>

        {/* Error digest for debugging (minimal) */}
        {error?.digest && (
          <p className="text-xs text-muted-foreground/60 mb-4 font-mono">
            كود المرجع: {error.digest}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors w-full sm:w-auto"
          >
            <RotateCcw className="h-4 w-4" />
            إعادة المحاولة
          </button>

          <button
            onClick={handleReload}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-border px-6 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:bg-muted active:bg-muted/80 transition-colors w-full sm:w-auto"
          >
            <RefreshCw className="h-4 w-4" />
            تحديث الصفحة
          </button>
        </div>
      </motion.div>
    </div>
  );
}

