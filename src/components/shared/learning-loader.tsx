'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useId, type CSSProperties } from 'react';

const PAGE_PATH = 'M80 48Q104 34 128 39V94Q104 86 80 99Z';
/** Thin curved strokes that read as lines of fine handwriting on a page; the last line is shorter. */
const TEXT_LINES = [0, 1, 2, 3, 4, 5]
  .map((k) => {
    const y = 55 + k * 7;
    const end = k === 5 ? 110 : 121;
    return `M88 ${y}Q104 ${y - 6} ${end} ${y - 3}`;
  })
  .join('');

/** Separate, original book animation for app startup and session recovery. */
export default function LearningLoader() {
  const reducedMotion = useReducedMotion();
  const shadeId = `ll-shade-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg viewBox="0 0 160 130" className="h-32 w-40" aria-hidden="true" data-learning-loader>
      <defs>
        {/* Soft shade that is darkest at the spine and fades toward the outer page edge. */}
        <linearGradient id={shadeId} gradientUnits="userSpaceOnUse" x1="80" y1="0" x2="128" y2="0">
          <stop offset="0" stopColor="#0f766e" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#0f766e" stopOpacity="0.08" />
          <stop offset="1" stopColor="#0f766e" stopOpacity="0" />
        </linearGradient>
      </defs>
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
          filter: drop-shadow(0 1.2px 1.4px rgba(15, 23, 42, 0.35));
        }
        @media (prefers-reduced-motion: reduce) {
          .ll-flip-page { animation: none; }
        }
      `}</style>
      {[4, 3, 2, 1, 0].map((i) => {
        const landed = -(1 - i * 0.025);
        const pageStyle = { animationDelay: `${i * 0.42}s`, '--ll-landed': `${landed}` } as CSSProperties;
        return (
          <g key={i} className="ll-flip-page" style={pageStyle}>
            <path d={PAGE_PATH} fill={i % 2 ? '#f0fdfa' : '#ffffff'} stroke="#99f6e4" strokeWidth="1.5" />
            <path d={PAGE_PATH} fill={`url(#${shadeId})`} />
            <path d={TEXT_LINES} stroke="#64748b" strokeOpacity="0.55" strokeWidth="0.7" strokeLinecap="round" fill="none" />
          </g>
        );
      })}
      <motion.path d="M80 11V23M74 17H86M139 24V32M135 28H143M20 27V35M16 31H24" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round"
        animate={{ opacity: reducedMotion ? 1 : [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} />
    </svg>
  );
}
