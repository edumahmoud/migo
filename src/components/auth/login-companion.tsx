'use client';

import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Original vector study companion. Receives focus state only, never field values. */
export default function LoginCompanion({ protecting = false, reading = false }: { protecting?: boolean; reading?: boolean }) {
  const eyes = useRef<SVGGElement>(null);
  const root = useRef<SVGSVGElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion || protecting || reading) return;
    const track = (event: PointerEvent) => {
      const box = root.current?.getBoundingClientRect();
      if (!box || !eyes.current) return;
      const x = Math.max(-4, Math.min(4, (event.clientX - box.x - box.width / 2) / 70));
      const y = Math.max(-3, Math.min(3, (event.clientY - box.y - box.height / 2) / 90));
      eyes.current.setAttribute('transform', `translate(${x} ${y})`);
    };
    window.addEventListener('pointermove', track, { passive: true });
    return () => {
      window.removeEventListener('pointermove', track);
      eyes.current?.removeAttribute('transform');
    };
  }, [protecting, reading, reducedMotion]);

  const spring = { type: 'spring' as const, stiffness: 220, damping: 20 };
  return (
    <svg ref={root} viewBox="0 0 140 116" className="h-20 w-24 shrink-0 sm:h-24 sm:w-28" aria-hidden="true" data-login-companion data-protecting={protecting}>
      <ellipse cx="70" cy="107" rx="43" ry="5" fill="#e0f2fe" />
      <circle cx="70" cy="55" r="47" fill="#f0fdfa" />
      <motion.g animate={{ y: reducedMotion ? 0 : [0, -2, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}>
        <path d="M43 101V83Q43 65 70 65T97 83V101" fill="#0284c7" />
        <rect x="30" y="22" width="80" height="62" rx="25" fill="#0f766e" />
        <rect x="36" y="26" width="68" height="51" rx="20" fill="#ccfbf1" />
        <path d="M70 23V15" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" />
        <circle cx="70" cy="12" r="5" fill="#38bdf8" />
        <g ref={eyes} transform={reading ? 'translate(0 3)' : undefined}>
          <ellipse cx="56" cy="48" rx="5" ry={protecting ? 1 : 7} fill="#0c4a6e" />
          <ellipse cx="84" cy="48" rx="5" ry={protecting ? 1 : 7} fill="#0c4a6e" />
          {!protecting && <><circle cx="57" cy="46" r="1.5" fill="white" /><circle cx="85" cy="46" r="1.5" fill="white" /></>}
        </g>
        <path d="M63 63Q70 69 77 63" stroke="#0f766e" strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx="45" cy="59" r="5" fill="#5eead4" opacity=".6" /><circle cx="95" cy="59" r="5" fill="#5eead4" opacity=".6" />
        {/* An open book anchors the companion to the form, rather than floating above it. */}
        <path d="M37 87Q53 83 70 91Q87 83 103 87V105Q86 101 70 109Q54 101 37 105Z" fill="#f8fafc" stroke="#7dd3fc" strokeWidth="2" />
        <path d="M70 91V108M44 92L61 94M79 94L96 92M44 98L61 100M79 100L96 98" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" />
        <motion.g animate={{ y: protecting ? -42 : 0, x: protecting ? 10 : 0, rotate: protecting ? -12 : 0 }} transition={reducedMotion ? { duration: 0 } : spring} style={{ transformOrigin: '35px 87px' }}>
          <rect x="23" y="78" width="22" height="18" rx="9" fill="#14b8a6" />
        </motion.g>
        <motion.g animate={{ y: protecting ? -42 : 0, x: protecting ? -10 : 0, rotate: protecting ? 12 : 0 }} transition={reducedMotion ? { duration: 0 } : spring} style={{ transformOrigin: '105px 87px' }}>
          <rect x="95" y="78" width="22" height="18" rx="9" fill="#14b8a6" />
        </motion.g>
      </motion.g>
      <path d="M118 26V34M114 30H122M18 64V70M15 67H21" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
