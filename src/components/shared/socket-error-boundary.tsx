'use client';

import React from 'react';

// Error boundary to prevent SocketProvider crashes from taking down the entire app.
// If socket.io fails (SSR issue, network error, etc.), we render children without socket.
// This must be a client component because it uses React.Component and state.
export default class SocketErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[SocketErrorBoundary] Socket provider crashed, falling back to no-socket mode:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Render children without socket context — app still works (Realtime mode)
      return this.props.children;
    }
    return this.props.children;
  }
}
