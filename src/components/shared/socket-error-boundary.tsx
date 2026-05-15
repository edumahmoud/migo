'use client';

import React from 'react';

/**
 * SocketErrorBoundary
 *
 * CRITICAL FIX: This error boundary wraps the SocketProvider.
 * When SocketProvider or socket.io-client crashes, we render children
 * WITHOUT the socket context by using a "slot" pattern.
 *
 * The parent (root layout) passes two render slots:
 *   - children: the full app with SocketProvider
 *   - fallback: the app WITHOUT SocketProvider (for error recovery)
 *
 * When an error is caught, we render the fallback slot instead of children.
 * This prevents the infinite error loop that occurred when we rendered
 * the same `this.props.children` in both error and non-error states.
 *
 * BEFORE (BUG): Both error and non-error states returned `this.props.children`,
 * which included SocketProvider. When SocketProvider threw, the error boundary
 * caught it, then rendered the same children (including SocketProvider), which
 * threw AGAIN, causing the error to propagate to the route-level error.tsx
 * showing "حدث خطأ غير متوقع" and crashing the entire app.
 */
interface SocketErrorBoundaryProps {
  /** Normal rendering: the full app WITH SocketProvider */
  children: React.ReactNode;
  /** Error fallback: the app WITHOUT SocketProvider */
  fallback: React.ReactNode;
}

interface SocketErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class SocketErrorBoundary extends React.Component<
  SocketErrorBoundaryProps,
  SocketErrorBoundaryState
> {
  constructor(props: SocketErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<SocketErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[SocketErrorBoundary] Socket provider crashed, falling back to no-socket mode:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Render the fallback slot (app WITHOUT SocketProvider)
      // This prevents re-rendering the crashing SocketProvider
      return this.props.fallback;
    }
    return this.props.children;
  }
}
