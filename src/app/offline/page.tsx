'use client';

import { motion } from 'framer-motion';
import { WifiOff, RefreshCw } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-sm"
      >
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 mb-6">
          <WifiOff className="h-10 w-10 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">لا يوجد اتصال</h1>
        <p className="text-muted-foreground mb-6 leading-relaxed">
          يبدو أنك غير متصل بالإنترنت. تحقق من اتصالك وحاول مرة أخرى.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          إعادة المحاولة
        </button>
      </motion.div>
    </div>
  );
}
