'use client';

import { useEffect } from 'react';

/**
 * Android WebView can come back from the background with a blank (white) page.
 * On resume: nudge a repaint, then if the page really is empty, reload once (guarded against loops).
 */
export default function ResumeGuard() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const root = document.documentElement;
      root.style.opacity = '0.999';
      requestAnimationFrame(() => {
        root.style.opacity = '';
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const body = document.body;
          const empty =
            !body ||
            (body.innerText.trim().length === 0 && !body.querySelector('img,svg,canvas,input,button'));
          if (!empty) return;
          const last = Number(sessionStorage.getItem('attendo-resume-reload') || '0');
          if (Date.now() - last < 60000) return;
          sessionStorage.setItem('attendo-resume-reload', String(Date.now()));
          window.location.reload();
        } catch {
          /* ignore */
        }
      }, 2500);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
