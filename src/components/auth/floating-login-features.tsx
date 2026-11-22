'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { useBrandingPointer } from '@/components/auth/branding-pointer-zone';
import { BrainCircuit, BookOpen, Users, Shield } from 'lucide-react';

const icons = [BrainCircuit, BookOpen, Users, Shield];
type Feature = { title: string; desc: string };

function FloatingFeature({ item, index }: { item: Feature; index: number }) {
  const root = useRef<HTMLDivElement>(null);
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 100, damping: 24 });
  const springY = useSpring(y, { stiffness: 100, damping: 24 });
  const lean = useSpring(0, { stiffness: 100, damping: 24 });
  const trackRef = useRef<(p: { x: number; y: number } | null) => void>(() => {});
  useBrandingPointer((p) => trackRef.current(p));

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reset = () => { x.set(0); y.set(0); lean.set(0); };
    trackRef.current = (p) => {
      const box = root.current?.getBoundingClientRect();
      if (!p || reduced || !media.matches || !box?.width) { reset(); return; }
      // Each icon follows from its own center, rather than moving the row as one block.
      const dx = Math.max(-1, Math.min(1, (p.x - box.left - box.width / 2) / 220));
      const dy = Math.max(-1, Math.min(1, (p.y - box.top - box.height / 2) / 200));
      x.set(dx * 7);
      y.set(dy * 5);
      lean.set(dx * 6);
    };
    if (reduced) reset();
    media.addEventListener('change', reset);
    return () => {
      media.removeEventListener('change', reset);
    };
  }, [reduced, x, y, lean]);

  const Icon = icons[index];
  return <motion.div ref={root} style={{ x: reduced ? 0 : springX, y: reduced ? 0 : springY, rotate: reduced ? 0 : lean }} data-floating-feature>
    <motion.div className="flex flex-col items-center gap-2 text-center"
      animate={reduced ? { y: 0 } : { y: [0, index % 2 ? 5 : -5, 0] }}
      transition={{ duration: 3.5 + index * 0.4, repeat: Infinity, ease: 'easeInOut' }}>
      <div className="flex h-11 w-11 items-center justify-center text-teal-200" aria-hidden="true"><Icon className="h-8 w-8" strokeWidth={1.5} /></div>
      <span className="text-xs xl:text-sm font-semibold text-white leading-relaxed">{item.title}</span>
      <span className="sr-only">{item.desc}</span>
    </motion.div>
  </motion.div>;
}

export default function FloatingLoginFeatures({ items }: { items: Feature[] }) {
  return <div className="grid grid-cols-4 gap-3 px-2" data-floating-features>
    {items.map((item, index) => <FloatingFeature key={item.title} item={item} index={index} />)}
  </div>;
}
