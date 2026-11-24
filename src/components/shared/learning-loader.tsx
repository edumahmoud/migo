'use client';

import { motion, useReducedMotion } from 'framer-motion';

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
      {/* Pages flip one after another from right to left, then the stack resets. */}
      {[4, 3, 2, 1, 0].map((i) => {
        const start = 0.08 + i * 0.1;
        const landed = -(1 - i * 0.025);
        return (
          <motion.path key={i} d="M80 47Q101 23 119 37V90Q100 80 80 99Z"
            fill={i % 2 ? '#f0fdfa' : '#ffffff'} stroke="#99f6e4" strokeWidth="1.5"
            style={{ transformOrigin: '80px 70px' }}
            animate={reducedMotion ? {} : { scaleX: [1, 1, landed, landed, landed, 1], opacity: [1, 1, 1, 1, 0, 1] }}
            transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', times: [0, start, start + 0.1, 0.88, 0.9, 0.93] }} />
        );
      })}
      <motion.path d="M80 11V23M74 17H86M139 24V32M135 28H143M20 27V35M16 31H24" stroke="#14b8a6" strokeWidth="3" strokeLinecap="round"
        animate={{ opacity: reducedMotion ? 1 : [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} />
    </svg>
  );
}
