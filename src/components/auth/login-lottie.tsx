'use client';

import { useEffect, useRef } from 'react';

interface LottieAnimationHandle {
  destroy: () => void;
  play: () => void;
  pause: () => void;
  goToAndStop: (frame: number, isFrame: boolean) => void;
  addEventListener: (name: string, callback: () => void) => void;
  loop: boolean;
}

declare global {
  interface Window {
    lottie?: {
      loadAnimation: (params: Record<string, unknown>) => LottieAnimationHandle;
    };
    __attendoLottieLoading?: Promise<void>;
  }
}

function loadLottieScript(): Promise<void> {
  if (window.lottie) return Promise.resolve();
  if (window.__attendoLottieLoading) return window.__attendoLottieLoading;
  window.__attendoLottieLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/lottie.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      window.__attendoLottieLoading = undefined;
      script.remove();
      reject(new Error('Failed to load lottie player'));
    };
    document.head.appendChild(script);
  });
  return window.__attendoLottieLoading;
}

/** A compact education illustration with gentle pointer parallax.
 * Touch users get the normal loop. Reduced-motion users get a still frame.
 * No field contents or user data are read by this component.
 */
export default function LoginLottie({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const scene = sceneRef.current;
    if (!container || !scene) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let animation: LottieAnimationHandle | undefined;
    let cancelled = false;
    let frame = 0;
    let latestX = 0;
    let latestY = 0;

    const reset = () => { scene.style.transform = ''; };
    const applyPreference = () => {
      reset();
      if (!animation) return;
      animation.loop = !reduced.matches;
      if (reduced.matches) animation.goToAndStop(0, true);
      else animation.play();
    };
    const track = (event: PointerEvent) => {
      if (reduced.matches || !finePointer.matches || event.pointerType !== 'mouse') return;
      latestX = event.clientX;
      latestY = event.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = container.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const x = Math.max(-1, Math.min(1, (latestX - box.left - box.width / 2) / 300));
        const y = Math.max(-1, Math.min(1, (latestY - box.top - box.height / 2) / 250));
        scene.style.transform = `perspective(600px) translate(${x * 5}px, ${y * 4}px) rotateX(${-y * 4}deg) rotateY(${x * 6}deg)`;
      });
    };

    loadLottieScript().then(() => {
      if (cancelled || !window.lottie) return;
      animation = window.lottie.loadAnimation({
        container: scene,
        renderer: 'svg',
        loop: !reduced.matches,
        autoplay: !reduced.matches,
        path: '/student-studying.json',
      });
      animation.addEventListener('DOMLoaded', applyPreference);
    }).catch(() => { /* Keep the form usable if the decorative asset fails. */ });

    window.addEventListener('pointermove', track, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    reduced.addEventListener('change', applyPreference);
    finePointer.addEventListener('change', reset);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', track);
      document.documentElement.removeEventListener('pointerleave', reset);
      reduced.removeEventListener('change', applyPreference);
      finePointer.removeEventListener('change', reset);
      animation?.destroy();
    };
  }, []);

  return <div ref={containerRef} className={className} data-login-lottie aria-hidden="true">
    <div ref={sceneRef} className="h-full w-full transition-transform duration-200 ease-out motion-reduce:transition-none" />
  </div>;
}
