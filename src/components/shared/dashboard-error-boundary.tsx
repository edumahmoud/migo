'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, GraduationCap } from 'lucide-react';

/**
 * DashboardErrorBoundary
 *
 * Catches runtime errors in dashboard components (Student, Teacher, Admin)
 * and shows a user-friendly error UI instead of crashing the entire app.
 * This is the #1 defense against post-login crashes.
 *
 * Without this boundary, any unhandled error in a dashboard component
 * propagates to the route-level error.tsx, which shows "حدث خطأ غير متوقع"
 * and the user perceives this as "the app crashed after login".
 *
 * With this boundary, the error is caught locally and the user gets:
 * 1. A clear message that something went wrong in the dashboard
 * 2. A retry button that re-mounts the dashboard component
 * 3. A fallback to the login page if retry doesn't help
 */
interface DashboardErrorBoundaryProps {
  children: React.ReactNode;
  /** Called when the user wants to go back to login */
  onFallbackToLogin?: () => void;
}

interface DashboardErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class DashboardErrorBoundary extends React.Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  constructor(props: DashboardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<DashboardErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[DashboardErrorBoundary] Dashboard component crashed:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoToLogin = () => {
    // Clear any corrupted state that might be causing the error
    try {
      localStorage.removeItem('attendo-app-store');
    } catch {}
    // Reload the page to start fresh
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
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
                حدث خطأ في تحميل لوحة التحكم
              </motion.h1>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-sm text-gray-500 mb-6 leading-relaxed"
              >
                حدث خطأ أثناء تحميل لوحة التحكم الخاصة بك. يمكنك المحاولة مرة أخرى أو العودة لتسجيل الدخول.
              </motion.p>

              {/* Error details (collapsible for debugging) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mb-5 text-left">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                    تفاصيل الخطأ (للمطورين)
                  </summary>
                  <pre className="mt-2 text-xs text-red-500 bg-red-50 p-3 rounded-lg overflow-auto max-h-32">
                    {this.state.error.message}
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </details>
              )}

              {/* Action buttons */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="flex flex-col sm:flex-row items-center justify-center gap-3"
              >
                <button
                  onClick={this.handleRetry}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 active:from-sky-900 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة المحاولة
                </button>

                <button
                  onClick={this.handleGoToLogin}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 w-full sm:w-auto"
                >
                  العودة لتسجيل الدخول
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

    return this.props.children;
  }
}
