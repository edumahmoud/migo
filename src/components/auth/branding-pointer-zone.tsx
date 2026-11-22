'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

// Linear red (x) and green (y) gradients: displacement toward the lens center = magnification.
const MAGNIFY_MAP = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="66" height="66"><defs>' +
  '<linearGradient id="h" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#000"/></linearGradient>' +
  '<linearGradient id="v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#000"/></linearGradient></defs>' +
  '<rect width="66" height="66" fill="#000"/><rect width="66" height="66" fill="url(#h)"/>' +
  '<rect width="66" height="66" fill="url(#v)" style="mix-blend-mode:screen"/></svg>');

export type ZonePointer = { x: number; y: number } | null;
type Listener = (p: ZonePointer) => void;
const ZoneContext = createContext<((fn: Listener) => () => void) | null>(null);

/** Subscribe to mouse movement that happens inside the branding half only.
 * The callback gets viewport coordinates, or null when the mouse leaves the half. */
export function useBrandingPointer(callback: Listener) {
  const subscribe = useContext(ZoneContext);
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => subscribe?.((p) => saved.current(p)), [subscribe]);
}

/** Wraps the branding half. Mouse interaction (character, icons, glass lens) is scoped to it.
 * Desktop mouse only; hidden-lens and no tracking for touch or reduced motion. */
export default function BrandingPointerZone({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLDivElement>(null);
  const listeners = useRef(new Set<Listener>());
  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  useEffect(() => {
    const el = root.current;
    const glass = lens.current;
    if (!el || !glass) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let last: ZonePointer = null;
    const emit = (p: ZonePointer) => listeners.current.forEach((fn) => fn(p));
    const hide = () => { glass.style.opacity = '0'; };
    const leave = () => { last = null; if (frame) { cancelAnimationFrame(frame); frame = 0; } hide(); emit(null); };
    const move = (e: PointerEvent) => {
      if (reduced.matches || !fine.matches || e.pointerType !== 'mouse') return;
      last = { x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!last) return;
        const box = el.getBoundingClientRect();
        glass.style.transform = `translate(${last.x - box.left - 33}px, ${last.y - box.top - 33}px)`;
        glass.style.opacity = '1';
        emit(last);
      });
    };
    const prefChange = () => { if (reduced.matches || !fine.matches) leave(); };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', leave);
    document.documentElement.addEventListener('pointerleave', leave);
    reduced.addEventListener('change', prefChange);
    fine.addEventListener('change', prefChange);
    return () => {
      leave();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      document.documentElement.removeEventListener('pointerleave', leave);
      reduced.removeEventListener('change', prefChange);
      fine.removeEventListener('change', prefChange);
    };
  }, []);

  return (
    <ZoneContext.Provider value={subscribe}>
      <div ref={root} className={className} data-branding-zone>
        {children}
        <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
          <defs>
            <filter id="login-lens-magnify" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feImage href={MAGNIFY_MAP} x="0" y="0" width="66" height="66" result="map" preserveAspectRatio="none" />
              <feDisplacementMap in="SourceGraphic" in2="map" scale="40" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        {/* Glass lens: clear glossy blob that follows the mouse above the text. Decorative, never intercepts input. */}
        <div ref={lens} aria-hidden="true" data-glass-lens
          className="pointer-events-none absolute left-0 top-0 z-20 h-[66px] w-[66px] opacity-0 login-glass-blob transition-opacity duration-200 motion-reduce:hidden"
          style={{
            willChange: 'transform',
            // Water-drop magnification of whatever is under the lens (Chromium; other browsers show clear glass only).
            backdropFilter: 'url(#login-lens-magnify)',
            WebkitBackdropFilter: 'url(#login-lens-magnify)',
            // Clear glossy glass: no blur, so the text underneath stays sharp.
            background: 'radial-gradient(ellipse at 28% 22%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.18) 18%, rgba(125,211,252,0.10) 55%, rgba(255,255,255,0.22) 100%)',
            border: '1.5px solid rgba(255,255,255,0.85)',
            boxShadow: 'inset 0 0 10px rgba(255,255,255,0.55), inset -6px -8px 14px rgba(56,189,248,0.25), 0 6px 16px rgba(8,47,73,0.25)',
          }} />
      </div>
    </ZoneContext.Provider>
  );
}
