'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';

/** Separate, original book animation for app startup and session recovery. */
export default function LearningLoader() {
  const reducedMotion = useReducedMotion();
  return (
    <svg viewBox="0 0 160 130" className="h-32 w-40" aria-hidden="true" data-learning-loader>
      <circle cx="80" cy="64" r="52" fill="#e0f2fe" />
      <ellipse cx="80" cy="112" rx="47" ry="5" fill="#bae6fd" />
      <path d="M27 43Q53 34 80 48Q107 34 133 43V101Q106 92 80 106Q54 92 27 101Z" fill="#0284c7" />
      <path d="M32 39Q56 34 80 48V99Q56 86 32 94Z" fill="#f0fdfa" />
      <path d="M128 39Q104 34 80 48V99Q104 86 128 94Z" fill="#ccfbf1" />
      <path d="M80 48V105" stroke="#0f766e" strokeWidth="3" />
      {[0, 1, 2].map((i) => (
        <motion.path key={i} d={`M41 ${55 + i * 12}Q55 ${52 + i * 12} 69 ${59 + i * 12}M91 ${59 + i * 12}Q105 ${52 + i * 12} 119 ${55 + i * 12}`}
          stroke="#5eead4" strokeWidth="4" strokeLinecap="round" fill="none"
          animate={{ opacity: reducedMotion ? 1 : [0.35, 1, 0.35] }} transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.18 }} />
      ))}
      {/* Pages start stacked on the right of the spine and flip over it to the left one after another, then the stack resets.
          Plain CSS keyframes on purpose: framer-motion forces transform-origin 50% 50% (fill-box center) on SVG children and ignores
          originX/originY props, which made the pages mirror in place on the same side of the book. */}
      <style>{`
        @keyframes ll-page-flip {
          0%, 8% { transform: scaleX(1); opacity: 1; }
          18% { transform: scaleX(var(--ll-landed)); opacity: 1; }
          88% { transform: scaleX(var(--ll-landed)); opacity: 1; }
          90% { transform: scaleX(var(--ll-landed)); opacity: 0; }
          93%, 100% { transform: scaleX(1); opacity: 1; }
        }
        .ll-flip-page {
          transform-box: view-box;
          transform-origin: 80px 70px;
          animation: ll-page-flip 4.2s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .ll-flip-page { animation: none; }
        }
      `}</style>
      {[4, 3, 2, 1, 0].map((i) => {
        const landed = -(1 - i * 0.025);
        const pageStyle = { animationDelay: `${i * 0.42}s`, '--ll-landed': `${landed}` } as CSSProperties;
        return (
          <path key={i} d="M80 48Q104 34 128 39V94Q104 86 80 99Z" className="ll-flip-page" style={pageStyle}
            fill={i % 2 ? '#f0fdfa' : '#ffffff'} stroke="#99f6e4" strokeWidth="1.5" />
        );
      })}
      <motion.path d="M80 11V23M74 17H86M139 24V32M135 28H143M20 27V35M16 31H24" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round"
        animate={{ opacity: reducedMotion ? 1 : [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} />
    </svg>
  );
}
