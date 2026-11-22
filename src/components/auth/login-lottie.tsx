'use client';

import { useEffect, useRef } from 'react';

interface LottieAnimationHandle {
  destroy: () => void;
}

declare global {
  interface Window {
    lottie?: {
      loadAnimation: (params: Record<string, unknown>) => LottieAnimationHandle;
    };
    __attendoLottieLoading?: Promise<void>;
  }
}

// Loads the vendored lottie-web player (/public/lottie.min.js) exactly once.
function loadLottieScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.lottie) return Promise.resolve();
  if (window.__attendoLottieLoading) return window.__attendoLottieLoading;
  window.__attendoLottieLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/lottie.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load lottie player'));
    document.head.appendChild(script);
  });
  return window.__attendoLottieLoading;
}

/**
 * Education-themed Lottie animation for the auth (login) page.
 * - Player is vendored at /lottie.min.js (lottie-web 5.13.0), so no new npm dependency.
 * - Animation JSON at /student-studying.json ("Girl studying on laptop", LottieFiles).
 * - Skips autoplay for users who prefer reduced motion.
 */
export default function LoginLottie({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let animation: LottieAnimationHandle | undefined;
    let cancelled = false;

    loadLottieScript()
      .then(() => {
        if (cancelled || !window.lottie) return;
        animation = window.lottie.loadAnimation({
          container,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          path: '/student-studying.json',
        });
      })
      .catch(() => {
        // If the player or animation fails to load, the login page works without it.
      });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, []);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}
