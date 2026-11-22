'use client';

import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { BrainCircuit, BookOpen, Users, Shield } from 'lucide-react';

const icons = [BrainCircuit, BookOpen, Users, Shield];

export default function FloatingLoginFeatures({ items }: { items: { title: string; desc: string }[] }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 100, damping: 24 });
  const springY = useSpring(y, { stiffness: 100, damping: 24 });
  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const track = (event: PointerEvent) => {
      const box = root.current?.getBoundingClientRect();
      if (reduced || !media.matches || event.pointerType !== 'mouse' || !box?.width) return;
      x.set(Math.max(-7, Math.min(7, (event.clientX - box.left - box.width / 2) / 50)));
      y.set(Math.max(-5, Math.min(5, (event.clientY - box.top - box.height / 2) / 60)));
    };
    const reset = () => { x.set(0); y.set(0); };
    if (reduced) reset();
    window.addEventListener('pointermove', track, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', track);
      document.documentElement.removeEventListener('pointerleave', reset);
    };
  }, [reduced, x, y]);

  return <motion.div ref={root} style={{ x: springX, y: springY }} className="absolute inset-0" data-floating-features>
    {items.map((item, i) => {
      const Icon = icons[i];
      return <motion.div key={item.title} className={`absolute flex w-24 xl:w-28 flex-col items-center gap-2 text-center ${['top-2 start-0', 'top-2 end-0', 'bottom-2 start-0', 'bottom-2 end-0'][i]}`}
        animate={reduced ? { y: 0, rotate: 0 } : { y: [0, i % 2 ? 5 : -5, 0], rotate: [0, i % 2 ? -2 : 2, 0] }}
        transition={{ duration: 3.5 + i * 0.4, repeat: Infinity, ease: 'easeInOut' }}>
        <div className="flex h-11 w-11 items-center justify-center text-teal-200" aria-hidden="true"><Icon className="h-8 w-8" strokeWidth={1.5} /></div>
        <span className="text-xs xl:text-sm font-semibold text-white leading-relaxed">{item.title}</span>
        <span className="sr-only">{item.desc}</span>
      </motion.div>;
    })}
  </motion.div>;
}
