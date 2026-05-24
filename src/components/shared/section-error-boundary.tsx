'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/** Functional wrapper for SectionErrorBoundary UI that uses i18n hooks */
function SectionErrorUI({ name, errorMsg, isDev, onRetry }: { name?: string; errorMsg: string; isDev: boolean; onRetry: () => void }) {
  const { t, dir } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center" dir={dir}>
      <AlertTriangle className="h-10 w-10 text-amber-500 mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">{t('common.errorUnexpected')}</h3>
      <p className="text-sm text-muted-foreground mb-2">
        {name ? `${t('common.section')} "${name}"` : t('common.thisSection')} {t('common.encounteredProblem')}
      </p>
      {isDev && (
        <div className="mb-4 max-w-md rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-end" dir="ltr">
          <p className="text-xs font-mono text-red-700 dark:text-red-300 break-all">{errorMsg}</p>
          {errorMsg && (
            <details className="mt-2">
              <summary className="text-xs text-red-600 dark:text-red-400 cursor-pointer">Stack trace</summary>
            </details>
          )}
        </div>
      )}
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
      >
        <RefreshCw className="h-4 w-4" />
        {t('common.retry')}
      </button>
    </div>
  );
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
      const errorMsg = this.state.error?.message || '';
      return <SectionErrorUI name={this.props.name} errorMsg={errorMsg} isDev={isDev} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}
