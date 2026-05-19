'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class SectionErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[SectionErrorBoundary${this.props.name ? ` (${this.props.name})` : ''}]`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const isDev = process.env.NODE_ENV === 'development';
      const errorMsg = this.state.error?.message || 'خطأ غير معروف';

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center" dir="rtl">
          <AlertTriangle className="h-10 w-10 text-amber-500 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">حدث خطأ في هذا القسم</h3>
          <p className="text-sm text-muted-foreground mb-2">
            {this.props.name ? `قسم "${this.props.name}"` : 'هذا القسم'} واجه مشكلة. يمكنك المحاولة مرة أخرى.
          </p>
          {isDev && (
            <div className="mb-4 max-w-md rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-right" dir="ltr">
              <p className="text-xs font-mono text-red-700 dark:text-red-300 break-all">{errorMsg}</p>
              {this.state.error?.stack && (
                <details className="mt-2">
                  <summary className="text-xs text-red-600 dark:text-red-400 cursor-pointer">Stack trace</summary>
                  <pre className="mt-1 text-[10px] font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap overflow-x-auto">{this.state.error.stack}</pre>
                </details>
              )}
            </div>
          )}
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
