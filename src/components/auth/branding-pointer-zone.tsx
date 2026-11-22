'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

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
  const content = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const listeners = useRef(new Set<Listener>());
  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);

  useEffect(() => {
    const el = root.current;
    const glass = lens.current;
    const src = content.current;
    const clip = inner.current;
    const dup = host.current;
    if (!el || !glass || !src || !clip || !dup) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let last: ZonePointer = null;
    let refresh = 0;
    // The lens shows a vector copy of the content scaled up, so magnified text stays sharp (no pixel filter).
    const SIZE = 66;
    const ZOOM = 1.4;
    const sync = () => {
      const copy = src.cloneNode(true) as HTMLElement;
      copy.removeAttribute('data-branding-content');
      copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      dup.replaceChildren(copy);
    };
    const stopRefresh = () => { if (refresh) { window.clearInterval(refresh); refresh = 0; } };
    const emit = (p: ZonePointer) => listeners.current.forEach((fn) => fn(p));
    const hide = () => { glass.style.opacity = '0'; stopRefresh(); };
    const leave = () => { last = null; if (frame) { cancelAnimationFrame(frame); frame = 0; } hide(); emit(null); };
    const move = (e: PointerEvent) => {
      if (reduced.matches || !fine.matches || e.pointerType !== 'mouse') return;
      last = { x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!last) return;
        const box = el.getBoundingClientRect();
        const cx = last.x - box.left;
        const cy = last.y - box.top;
        glass.style.transform = `translate(${cx - SIZE / 2}px, ${cy - SIZE / 2}px)`;
        // Keep the lens background equal to the panel gradient so the copy fully covers the text beneath.
        const bg = window.getComputedStyle(el.parentElement ?? el).backgroundImage;
        clip.style.backgroundImage = bg;
        clip.style.backgroundSize = `${box.width}px ${box.height}px`;
        clip.style.backgroundPosition = `${-(cx - SIZE / 2)}px ${-(cy - SIZE / 2)}px`;
        dup.style.width = `${box.width}px`;
        dup.style.height = `${box.height}px`;
        dup.style.transform = `translate(${SIZE / 2 - cx * ZOOM}px, ${SIZE / 2 - cy * ZOOM}px) scale(${ZOOM})`;
        if (!refresh) { sync(); refresh = window.setInterval(sync, 120); }
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
      <div ref={root} className="absolute inset-0" data-branding-zone>
        <div ref={content} className={className} data-branding-content>{children}</div>
        {/* Glass lens: a clear glossy blob holding a scaled vector copy of the content. Decorative, never intercepts input. */}
        <div ref={lens} aria-hidden="true" data-glass-lens
          className="pointer-events-none absolute left-0 top-0 z-20 h-[66px] w-[66px] opacity-0 login-glass-blob transition-opacity duration-200 motion-reduce:hidden"
          style={{
            willChange: 'transform',
            boxShadow: '0 6px 16px rgba(8,47,73,0.25)',
          }}>
          <div ref={inner} className="login-glass-blob absolute inset-0 overflow-hidden">
            <div ref={host} className="absolute left-0 top-0 origin-top-left" style={{ willChange: 'transform' }} />
          </div>
          <div className="login-glass-blob absolute inset-0" style={{
            background: 'radial-gradient(ellipse at 28% 22%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.15) 18%, rgba(125,211,252,0.06) 55%, rgba(255,255,255,0.16) 100%)',
            border: '1.5px solid rgba(255,255,255,0.85)',
            boxShadow: 'inset 0 0 10px rgba(255,255,255,0.5), inset -6px -8px 14px rgba(56,189,248,0.22)',
          }} />
        </div>
      </div>
    </ZoneContext.Provider>
  );
}
