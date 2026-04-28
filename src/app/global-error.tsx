'use client';

import { useEffect } from 'react';

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

  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
        <div className="text-center max-w-sm mx-auto">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-red-50 mb-6 ring-4 ring-red-100/50">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-red-500"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          </div>

          <h1 className="text-xl font-bold text-foreground mb-2">
            خطأ حرج في التطبيق
          </h1>

          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            حدث خطأ فادح يمنع تشغيل التطبيق. يرجى تحديث الصفحة أو المحاولة لاحقاً.
          </p>

          {error?.digest && (
            <p className="text-xs text-muted-foreground/60 mb-4 font-mono">
              كود المرجع: {error.digest}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors w-full sm:w-auto"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              إعادة المحاولة
            </button>

            <button
              onClick={handleReload}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-border px-6 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:bg-muted active:bg-muted/80 transition-colors w-full sm:w-auto"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              تحديث الصفحة
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

