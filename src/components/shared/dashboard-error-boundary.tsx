'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, GraduationCap, LogOut, RotateCcw } from 'lucide-react';

/**
 * DashboardErrorBoundary
 *
 * Catches runtime errors in dashboard components (Student, Teacher, Admin)
 * and shows a user-friendly error UI instead of crashing the entire app.
 * This is the #1 defense against post-login crashes.
 *
 * CRITICAL FIX (v3):
 * - retryCount now resets to 0 after 5 seconds of successful rendering,
 *   preventing permanent lockout from transient errors.
 * - Retry button is ALWAYS available, even after MAX_RETRIES.
 *   After MAX_RETRIES, a different message suggests going back to login.
 * - Added "Reset App" button that clears ALL Zustand stores + localStorage
 *   and reloads the page for a full clean slate.
 * - handleRetry resets retryCount to 0 so users always get a fresh start.
 *
 * Without this boundary, any unhandled error in a dashboard component
 * propagates to the route-level error.tsx, which shows "حدث خطأ غير متوقع"
 * and the user perceives this as "the app crashed after login".
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
  retryCount: number;
  /** Changing this key forces React to remount children */
  retryKey: number;
  /** Whether auto-retry is in progress */
  autoRetrying: boolean;
}

const MAX_RETRIES = 3;

export default class DashboardErrorBoundary extends React.Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  /** Timer reference for the successful-render reset */
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: DashboardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0, retryKey: 0, autoRetrying: false };
  }

  static getDerivedStateFromError(error: Error): Partial<DashboardErrorBoundaryState> {
    return { hasError: true, error, autoRetrying: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[DashboardErrorBoundary] Dashboard component crashed:', error, errorInfo);

    // Cancel any pending recovery timer since we're back in an error state
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    this.setState(prev => ({
      errorInfo,
      retryCount: prev.retryCount + 1,
    }));

    // Auto-retry after 2 seconds on first error
    if (this.state.retryCount === 0) {
      this.setState({ autoRetrying: true });
      setTimeout(() => {
        this.handleRetry();
      }, 2000);
    }
  }

  componentDidUpdate(
    _prevProps: DashboardErrorBoundaryProps,
    prevState: DashboardErrorBoundaryState
  ) {
    // When the component recovers from an error state (hasError went from true to false),
    // start a 5-second timer. If the component is still error-free after 5 seconds,
    // reset retryCount to 0 so the user isn't permanently locked out.
    if (prevState.hasError && !this.state.hasError) {
      // Clear any existing timer
      if (this.recoveryTimer) {
        clearTimeout(this.recoveryTimer);
      }
      this.recoveryTimer = setTimeout(() => {
        // Only reset if we're still error-free
        if (!this.state.hasError && this.state.retryCount > 0) {
          this.setState({ retryCount: 0 });
        }
        this.recoveryTimer = null;
      }, 5000);
    }
  }

  componentWillUnmount() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  handleRetry = () => {
    // Clear potentially corrupted state that might be causing the error
    try {
      localStorage.removeItem('attendo-app-store');
      localStorage.removeItem('_wsr');
      localStorage.removeItem('_sw_reload_pending');
      localStorage.removeItem('_attendo_busy');
    } catch {}

    // Reset retryCount to give users a fresh start on manual retry
    // Force remount by changing the key
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      autoRetrying: false,
      retryCount: 0,
      retryKey: prev.retryKey + 1,
    }));
  };

  handleResetApp = () => {
    // Clear ALL app state — localStorage and Zustand stores — then reload
    try {
      // Clear known localStorage keys
      localStorage.removeItem('attendo-app-store');
      localStorage.removeItem('_wsr');
      localStorage.removeItem('_sw_reload_pending');
      localStorage.removeItem('_attendo_busy');

      // Reset Zustand stores directly
      // We import dynamically to avoid circular deps in a class component
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useAppStore } = require('@/stores/app-store');
        useAppStore.getState().reset();
      } catch {}
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useNotificationStore } = require('@/stores/notification-store');
        useNotificationStore.getState().cleanup();
      } catch {}
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useStatusStore } = require('@/stores/status-store');
        useStatusStore.getState().cleanup();
      } catch {}
    } catch {}

    // Full page reload for a completely clean slate
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  handleGoToLogin = () => {
    // Clear any corrupted state that might be causing the error
    try {
      localStorage.removeItem('attendo-app-store');
      localStorage.removeItem('_wsr');
      localStorage.removeItem('_sw_reload_pending');
      localStorage.removeItem('_attendo_busy');
    } catch {}

    // Prefer calling onFallbackToLogin prop for a clean sign-out
    // instead of a full page reload which can hit the same crash
    if (this.props.onFallbackToLogin) {
      this.props.onFallbackToLogin();
    } else if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      const tooManyRetries = this.state.retryCount >= MAX_RETRIES;

      // Auto-retry UI — show spinner instead of error buttons
      if (this.state.autoRetrying) {
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
                <span className="text-sm font-medium text-sky-800">جاري محاولة إعادة التحميل...</span>
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
                {tooManyRetries ? 'تعذر تحميل لوحة التحكم' : 'حدث خطأ في تحميل لوحة التحكم'}
              </motion.h1>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-sm text-gray-500 mb-6 leading-relaxed"
              >
                {tooManyRetries
                  ? 'تعذر تحميل لوحة التحكم بعد عدة محاولات. يمكنك المحاولة مرة أخرى أو إعادة تعيين التطبيق بالكامل.'
                  : 'حدث خطأ أثناء تحميل لوحة التحكم الخاصة بك. يمكنك المحاولة مرة أخرى أو العودة لتسجيل الدخول.'}
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

              {/* Retry count indicator */}
              {this.state.retryCount > 1 && (
                <p className="text-xs text-amber-600 mb-4">
                  محاولة {this.state.retryCount} من {MAX_RETRIES}
                </p>
              )}

              {/* Action buttons — retry is ALWAYS available */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="flex flex-col items-center justify-center gap-3"
              >
                <button
                  onClick={this.handleRetry}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-sky-700 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/25 hover:from-sky-800 hover:to-teal-700 active:from-sky-900 active:to-teal-800 transition-all duration-300 w-full sm:w-auto"
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة المحاولة
                </button>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
                  <button
                    onClick={this.handleGoToLogin}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 w-full sm:w-auto"
                  >
                    <LogOut className="h-4 w-4" />
                    العودة لتسجيل الدخول
                  </button>

                  <button
                    onClick={this.handleResetApp}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white border border-red-200 px-6 py-2.5 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-50 active:bg-red-100 transition-all duration-200 w-full sm:w-auto"
                  >
                    <RotateCcw className="h-4 w-4" />
                    إعادة تعيين التطبيق
                  </button>
                </div>
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

    // Use retryKey to force remount of children on retry
    // This ensures that any stale state from the crashed component is reset
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
