'use client';

import { motion, useReducedMotion } from 'framer-motion';
import LearningLoader from '@/components/shared/learning-loader';

export type MascotKind = 'book' | 'video' | 'ai';

/** Light SVG mascots for loading states. Reuses the book from the app loader; respects reduced motion. */
export default function MascotLoader({ kind = 'book', size = 112, label, className = '' }: {
  kind?: MascotKind;
  size?: number;
  label?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`} role="status" aria-live="polite" data-mascot-loader={kind}>
      <div style={{ width: size, height: size * 0.8 }} className="flex items-center justify-center overflow-visible">
        {kind === 'book' && (
          <div style={{ transform: `scale(${size / 160})`, transformOrigin: 'center' }} className="shrink-0">
            <LearningLoader />
          </div>
        )}
        {kind === 'video' && (
          <svg viewBox="0 0 160 130" width={size} height={size * 0.8125} aria-hidden="true">
            <circle cx="80" cy="64" r="52" fill="#e0f2fe" />
            <ellipse cx="80" cy="112" rx="42" ry="5" fill="#bae6fd" />
            <motion.g animate={reduced ? {} : { y: [0, -4, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}>
              <rect x="30" y="34" width="100" height="68" rx="12" fill="#0284c7" />
              <rect x="37" y="41" width="86" height="54" rx="7" fill="#f0fdfa" />
              <circle cx="46" cy="38" r="0" />
              <motion.path d="M70 54V82L96 68Z" fill="#14b8a6" style={{ transformOrigin: '80px 68px' }}
                animate={reduced ? {} : { scale: [1, 1.15, 1] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
              <motion.rect x="42" y="88" height="4" rx="2" fill="#5eead4" animate={reduced ? { width: 50 } : { width: [8, 76, 8] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
            </motion.g>
          </svg>
        )}
        {kind === 'ai' && (
          <svg viewBox="0 0 160 130" width={size} height={size * 0.8125} aria-hidden="true">
            <circle cx="80" cy="64" r="52" fill="#ede9fe" />
            <ellipse cx="80" cy="112" rx="42" ry="5" fill="#ddd6fe" />
            <motion.g animate={reduced ? {} : { y: [0, -4, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}>
              <rect x="40" y="38" width="80" height="62" rx="16" fill="#7c3aed" />
              <rect x="47" y="45" width="66" height="48" rx="10" fill="#f5f3ff" />
              <motion.path d="M80 50L86 66L102 72L86 78L80 94L74 78L58 72L74 66Z" fill="#8b5cf6" style={{ transformOrigin: '80px 72px' }}
                animate={reduced ? {} : { scale: [1, 1.18, 1], rotate: [0, 15, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
              <path d="M80 38V28" stroke="#7c3aed" strokeWidth="4" strokeLinecap="round" />
              <motion.circle cx="80" cy="24" r="5" fill="#c4b5fd" animate={{ opacity: reduced ? 1 : [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} />
            </motion.g>
          </svg>
        )}
      </div>
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
  );
}
