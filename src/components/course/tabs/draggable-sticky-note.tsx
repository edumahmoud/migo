'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Minus, StickyNote as StickyNoteIcon } from 'lucide-react';

interface DraggableStickyNoteProps {
  id: string;
  content: string;
  authorName: string;
  onClose: (id: string) => void;
  direction?: 'rtl' | 'ltr';
  labelSticky?: string;
}

// Position storage key prefix
const STICKY_POS_PREFIX = 'attendo_sticky_pos_';

function getStoredPosition(id: string): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(`${STICKY_POS_PREFIX}${id}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function storePosition(id: string, x: number, y: number): void {
  try {
    localStorage.setItem(`${STICKY_POS_PREFIX}${id}`, JSON.stringify({ x, y }));
  } catch { /* ignore */ }
}

export default function DraggableStickyNote({
  id,
  content,
  authorName,
  onClose,
  direction = 'rtl',
  labelSticky = 'Sticky Note',
}: DraggableStickyNoteProps) {
  const [minimized, setMinimized] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Initialize position from localStorage or a smart default
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const stored = getStoredPosition(id);
    if (stored) {
      // Clamp to viewport
      return {
        x: Math.min(stored.x, window.innerWidth - 280),
        y: Math.min(stored.y, window.innerHeight - 150),
      };
    }
    // Stagger notes: use id hash for offset
    const hash = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      x: 20 + (hash % 5) * 40,
      y: 80 + (hash % 4) * 50,
    };
  });

  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // --- Mouse drag ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (minimized) return;
    e.preventDefault();
    setDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position, minimized]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - 280));
      const newY = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - 100));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setDragging(false);
      storePosition(id, position.x, position.y);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, id, position]);

  // --- Touch drag ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (minimized) return;
    const touch = e.touches[0];
    setDragging(true);
    dragOffset.current = {
      x: touch.clientX - position.x,
      y: touch.clientY - position.y,
    };
  }, [position, minimized]);

  useEffect(() => {
    if (!dragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const newX = Math.max(0, Math.min(touch.clientX - dragOffset.current.x, window.innerWidth - 280));
      const newY = Math.max(0, Math.min(touch.clientY - dragOffset.current.y, window.innerHeight - 100));
      setPosition({ x: newX, y: newY });
    };

    const handleTouchEnd = () => {
      setDragging(false);
      storePosition(id, position.x, position.y);
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [dragging, id, position]);

  // Persist position on unmount
  useEffect(() => {
    return () => {
      storePosition(id, position.x, position.y);
    };
  }, [id, position.x, position.y]);

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed z-40 flex items-center gap-1.5 rounded-full bg-amber-300 dark:bg-amber-600 px-3 py-1.5 shadow-lg hover:shadow-xl transition-all text-amber-900 dark:text-amber-100 text-xs font-medium border border-amber-400 dark:border-amber-500"
        style={{ left: position.x, top: position.y }}
        dir={direction}
      >
        <StickyNoteIcon className="h-3.5 w-3.5" />
        <span className="truncate max-w-[120px]">{content.slice(0, 30)}{content.length > 30 ? '...' : ''}</span>
      </button>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`fixed z-40 w-64 rounded-xl shadow-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/80 text-amber-950 dark:text-amber-100 transition-shadow ${
        dragging ? 'shadow-2xl cursor-grabbing' : 'shadow-lg cursor-grab'
      }`}
      style={{ left: position.x, top: position.y }}
      dir={direction}
    >
      {/* Header / drag handle */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-amber-200/60 dark:bg-amber-800/60 rounded-t-xl border-b border-amber-300/50 dark:border-amber-700/50 select-none"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div className="flex items-center gap-1.5">
          <StickyNoteIcon className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {labelSticky}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); setMinimized(true); }}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-amber-300/50 dark:hover:bg-amber-700/50 transition-colors"
            aria-label="Minimize"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(id); }}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-rose-300/50 dark:hover:bg-rose-700/50 transition-colors"
            aria-label="Close"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2.5 max-h-32 overflow-y-auto custom-scrollbar">
        <p className="text-xs leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>

      {/* Footer */}
      {authorName && (
        <div className="px-3 py-1.5 border-t border-amber-200/50 dark:border-amber-700/30">
          <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate">{authorName}</p>
        </div>
      )}
    </div>
  );
}
