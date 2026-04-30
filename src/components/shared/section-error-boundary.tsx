'use client';

import React from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

// -------------------------------------------------------
// Types
// -------------------------------------------------------
interface SectionErrorBoundaryProps {
  children: React.ReactNode;
  sectionName?: string; // Optional: name of the section for debugging
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------
export class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<SectionErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[SectionErrorBoundary${this.props.sectionName ? ` (${this.props.sectionName})` : ''}]`,
      error,
      errorInfo
    );
    this.setState({ errorInfo });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center p-6 text-center rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-teal-50/80"
          dir="rtl"
        >
          {/* Icon */}
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 mb-4">
            <AlertTriangle className="h-7 w-7 text-emerald-600" />
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-gray-900 mb-1">
            حدث خطأ أثناء تحميل هذا القسم
          </h3>

          {/* Subtitle */}
          {this.props.sectionName && (
            <p className="text-sm text-gray-500 mb-4">
              قسم &quot;{this.props.sectionName}&quot;
            </p>
          )}

          {/* Retry button */}
          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 text-white text-sm font-semibold shadow-md shadow-emerald-200/50 hover:from-emerald-700 hover:to-teal-700 active:from-emerald-800 active:to-teal-800 transition-all duration-200"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </button>

          {/* Collapsible error details */}
          {this.state.error && (
            <div className="w-full mt-4">
              <button
                onClick={this.toggleDetails}
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-500 transition-colors"
              >
                {this.state.showDetails ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                تفاصيل الخطأ
              </button>

              {this.state.showDetails && (
                <div className="mt-2 rounded-lg bg-white/80 border border-emerald-100 p-3 text-right">
                  <p className="text-xs font-medium text-red-600 mb-1">
                    {this.state.error.toString()}
                  </p>
                  {this.state.errorInfo && (
                    <pre className="text-[10px] text-gray-400 whitespace-pre-wrap overflow-auto max-h-32 leading-relaxed font-mono">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
