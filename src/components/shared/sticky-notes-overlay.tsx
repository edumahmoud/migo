'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useAuthStore } from '@/stores/auth-store';
import type { StickyNoteData } from '@/lib/types';

// -------------------------------------------------------
// Defaults & constraints
// -------------------------------------------------------
const DEFAULT_NOTE_WIDTH = 280;
const DEFAULT_NOTE_HEIGHT = 200;
const MIN_NOTE_WIDTH = 180;
const MIN_NOTE_HEIGHT = 120;

// -------------------------------------------------------
// Position & visibility storage
// -------------------------------------------------------
const POS_PREFIX = 'attendo_sticky_pos_';
const VIS_PREFIX = 'attendo_sticky_vis_';

function getStoredPosition(id: string): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(`${POS_PREFIX}${id}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function storePosition(id: string, x: number, y: number): void {
  try {
    localStorage.setItem(`${POS_PREFIX}${id}`, JSON.stringify({ x, y }));
  } catch { /* ignore */ }
}

/** Get the local visibility override (true = shown/expanded, false = minimized) */
function getStoredVisibility(id: string): boolean | null {
  try {
    const raw = localStorage.getItem(`${VIS_PREFIX}${id}`);
    if (raw !== null) return raw === '1';
  } catch { /* ignore */ }
  return null;
}

/** Store local visibility override */
function storeVisibility(id: string, visible: boolean): void {
  try {
    localStorage.setItem(`${VIS_PREFIX}${id}`, visible ? '1' : '0');
  } catch { /* ignore */ }
}

// -------------------------------------------------------
// Color map for sticky notes
// -------------------------------------------------------
type StickyColor = 'amber' | 'blue' | 'green' | 'rose' | 'purple' | 'orange';

const stickyColorClasses: Record<StickyColor, {
  bg: string;
  border: string;
  text: string;
  headerBg: string;
  headerBorder: string;
  minimizedBg: string;
  minimizedBorder: string;
  minimizedText: string;
  hoverBtn: string;
  inputBorder: string;
  inputBg: string;
  hintText: string;
}> = {
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-900/80',
    border: 'border-amber-300 dark:border-amber-700',
    text: 'text-amber-950 dark:text-amber-100',
    headerBg: 'bg-amber-200/60 dark:bg-amber-800/60',
    headerBorder: 'border-amber-300/50 dark:border-amber-700/50',
    minimizedBg: 'bg-amber-300 dark:bg-amber-600',
    minimizedBorder: 'border-amber-400 dark:border-amber-500',
    minimizedText: 'text-amber-900 dark:text-amber-100',
    hoverBtn: 'hover:bg-amber-300/50 dark:hover:bg-amber-700/50',
    inputBorder: 'border-amber-300 dark:border-amber-700',
    inputBg: 'bg-white dark:bg-amber-900/50',
    hintText: 'text-amber-500',
  },
  blue: {
    bg: 'bg-sky-50 dark:bg-sky-900/80',
    border: 'border-sky-300 dark:border-sky-700',
    text: 'text-sky-950 dark:text-sky-100',
    headerBg: 'bg-sky-200/60 dark:bg-sky-800/60',
    headerBorder: 'border-sky-300/50 dark:border-sky-700/50',
    minimizedBg: 'bg-sky-300 dark:bg-sky-600',
    minimizedBorder: 'border-sky-400 dark:border-sky-500',
    minimizedText: 'text-sky-900 dark:text-sky-100',
    hoverBtn: 'hover:bg-sky-300/50 dark:hover:bg-sky-700/50',
    inputBorder: 'border-sky-300 dark:border-sky-700',
    inputBg: 'bg-white dark:bg-sky-900/50',
    hintText: 'text-sky-500',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/80',
    border: 'border-emerald-300 dark:border-emerald-700',
    text: 'text-emerald-950 dark:text-emerald-100',
    headerBg: 'bg-emerald-200/60 dark:bg-emerald-800/60',
    headerBorder: 'border-emerald-300/50 dark:border-emerald-700/50',
    minimizedBg: 'bg-emerald-300 dark:bg-emerald-600',
    minimizedBorder: 'border-emerald-400 dark:border-emerald-500',
    minimizedText: 'text-emerald-900 dark:text-emerald-100',
    hoverBtn: 'hover:bg-emerald-300/50 dark:hover:bg-emerald-700/50',
    inputBorder: 'border-emerald-300 dark:border-emerald-700',
    inputBg: 'bg-white dark:bg-emerald-900/50',
    hintText: 'text-emerald-500',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-900/80',
    border: 'border-rose-300 dark:border-rose-700',
    text: 'text-rose-950 dark:text-rose-100',
    headerBg: 'bg-rose-200/60 dark:bg-rose-800/60',
    headerBorder: 'border-rose-300/50 dark:border-rose-700/50',
    minimizedBg: 'bg-rose-300 dark:bg-rose-600',
    minimizedBorder: 'border-rose-400 dark:border-rose-500',
    minimizedText: 'text-rose-900 dark:text-rose-100',
    hoverBtn: 'hover:bg-rose-300/50 dark:hover:bg-rose-700/50',
    inputBorder: 'border-rose-300 dark:border-rose-700',
    inputBg: 'bg-white dark:bg-rose-900/50',
    hintText: 'text-rose-500',
  },
  purple: {
    bg: 'bg-violet-50 dark:bg-violet-900/80',
    border: 'border-violet-300 dark:border-violet-700',
    text: 'text-violet-950 dark:text-violet-100',
    headerBg: 'bg-violet-200/60 dark:bg-violet-800/60',
    headerBorder: 'border-violet-300/50 dark:border-violet-700/50',
    minimizedBg: 'bg-violet-300 dark:bg-violet-600',
    minimizedBorder: 'border-violet-400 dark:border-violet-500',
    minimizedText: 'text-violet-900 dark:text-violet-100',
    hoverBtn: 'hover:bg-violet-300/50 dark:hover:bg-violet-700/50',
    inputBorder: 'border-violet-300 dark:border-violet-700',
    inputBg: 'bg-white dark:bg-violet-900/50',
    hintText: 'text-violet-500',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-900/80',
    border: 'border-orange-300 dark:border-orange-700',
    text: 'text-orange-950 dark:text-orange-100',
    headerBg: 'bg-orange-200/60 dark:bg-orange-800/60',
    headerBorder: 'border-orange-300/50 dark:border-orange-700/50',
    minimizedBg: 'bg-orange-300 dark:bg-orange-600',
    minimizedBorder: 'border-orange-400 dark:border-orange-500',
    minimizedText: 'text-orange-900 dark:text-orange-100',
    hoverBtn: 'hover:bg-orange-300/50 dark:hover:bg-orange-700/50',
    inputBorder: 'border-orange-300 dark:border-orange-700',
    inputBg: 'bg-white dark:bg-orange-900/50',
    hintText: 'text-orange-500',
  },
};

function getColorClasses(color: string) {
  return stickyColorClasses[(color as StickyColor) || 'amber'] || stickyColorClasses.amber;
}

// -------------------------------------------------------
// Single Sticky Note Card (draggable, color-aware)
// -------------------------------------------------------
function StickyNoteCard({
  note,
  onUpdate,
  onDelete,
  direction,
}: {
  note: StickyNoteData;
  onUpdate: (id: string, updates: Partial<StickyNoteData>) => void;
  onDelete: (id: string) => void;
  direction: 'rtl' | 'ltr';
}) {
  const colors = getColorClasses(note.color);
  const [minimized, setMinimized] = useState(() => {
    // Prefer localStorage override, fallback to DB value
    const stored = getStoredVisibility(note.id);
    return stored !== null ? !stored : note.is_minimized;
  });
  const initialWidth = note.width ?? DEFAULT_NOTE_WIDTH;
  const initialHeight = note.height ?? DEFAULT_NOTE_HEIGHT;
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const stored = getStoredPosition(note.id);
    if (stored) {
      return {
        x: Math.min(stored.x, window.innerWidth - initialWidth),
        y: Math.min(stored.y, window.innerHeight - initialHeight),
      };
    }
    return { x: note.position_x, y: note.position_y };
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({
    w: initialWidth,
    h: initialHeight,
  }));
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // Mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (minimized) return;
    e.preventDefault();
    setDragging(true);
    dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position, minimized]);

  useEffect(() => {
    if (!dragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - size.w));
      const newY = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - 100));
      setPosition({ x: newX, y: newY });
    };
    const handleMouseUp = () => {
      setDragging(false);
      storePosition(note.id, position.x, position.y);
      onUpdate(note.id, { position_x: position.x, position_y: position.y });
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [dragging, note.id, position, size.w, onUpdate]);

  // Touch drag
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (minimized) return;
    const touch = e.touches[0];
    setDragging(true);
    dragOffset.current = { x: touch.clientX - position.x, y: touch.clientY - position.y };
  }, [position, minimized]);

  useEffect(() => {
    if (!dragging) return;
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const newX = Math.max(0, Math.min(touch.clientX - dragOffset.current.x, window.innerWidth - size.w));
      const newY = Math.max(0, Math.min(touch.clientY - dragOffset.current.y, window.innerHeight - 100));
      setPosition({ x: newX, y: newY });
    };
    const handleTouchEnd = () => {
      setDragging(false);
      storePosition(note.id, position.x, position.y);
      onUpdate(note.id, { position_x: position.x, position_y: position.y });
    };
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => { window.removeEventListener('touchmove', handleTouchMove); window.removeEventListener('touchend', handleTouchEnd); };
  }, [dragging, note.id, position, size.w, onUpdate]);

  // Mouse resize
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
  }, [size]);

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const isRTL = direction === 'rtl';
      const dx = isRTL ? resizeStart.current.x - e.clientX : e.clientX - resizeStart.current.x;
      const dy = e.clientY - resizeStart.current.y;
      setSize({
        w: Math.max(MIN_NOTE_WIDTH, resizeStart.current.w + dx),
        h: Math.max(MIN_NOTE_HEIGHT, resizeStart.current.h + dy),
      });
    };
    const handleMouseUp = () => {
      setResizing(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [resizing, direction]);

  // Touch resize
  const handleResizeTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    setResizing(true);
    resizeStart.current = { x: touch.clientX, y: touch.clientY, w: size.w, h: size.h };
  }, [size]);

  useEffect(() => {
    if (!resizing) return;
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const isRTL = direction === 'rtl';
      const dx = isRTL ? resizeStart.current.x - touch.clientX : touch.clientX - resizeStart.current.x;
      const dy = touch.clientY - resizeStart.current.y;
      setSize({
        w: Math.max(MIN_NOTE_WIDTH, resizeStart.current.w + dx),
        h: Math.max(MIN_NOTE_HEIGHT, resizeStart.current.h + dy),
      });
    };
    const handleTouchEnd = () => {
      setResizing(false);
    };
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => { window.removeEventListener('touchmove', handleTouchMove); window.removeEventListener('touchend', handleTouchEnd); };
  }, [resizing, direction]);

  // Save edited content
  const handleSaveContent = useCallback(() => {
    if (editContent.trim() && editContent.trim() !== note.content) {
      onUpdate(note.id, { content: editContent.trim() });
    }
    setEditing(false);
  }, [editContent, note.id, note.content, onUpdate]);

  // Persist position on unmount
  useEffect(() => {
    return () => { storePosition(note.id, position.x, position.y); };
  }, [note.id, position.x, position.y]);

  if (minimized) {
    return (
      <button
        onClick={() => { setMinimized(false); storeVisibility(note.id, true); onUpdate(note.id, { is_minimized: false }); }}
        className={`fixed z-[60] flex items-center gap-1.5 rounded-full ${colors.minimizedBg} ${colors.minimizedBorder} border px-3 py-1.5 shadow-lg hover:shadow-xl transition-all ${colors.minimizedText} text-xs font-medium`}
        style={{ left: position.x, top: position.y }}
        dir={direction}
      >
        <span className="truncate max-w-[120px]">{note.content.slice(0, 30)}{note.content.length > 30 ? '...' : ''}</span>
      </button>
    );
  }

  return (
    <div
      className={`fixed z-[60] flex flex-col rounded-xl shadow-xl border ${colors.border} ${colors.bg} ${colors.text} transition-shadow group ${
        dragging ? 'shadow-2xl cursor-grabbing' : resizing ? 'shadow-2xl' : 'shadow-lg cursor-grab'
      }`}
      style={{ left: position.x, top: position.y, width: size.w, height: size.h }}
      dir={direction}
    >
      {/* Header / drag handle */}
      <div
        className={`flex items-center justify-between px-3 py-2 ${colors.headerBg} rounded-t-xl border-b ${colors.headerBorder} select-none`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <span className="text-[10px] font-bold uppercase tracking-wide">📌</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(!editing); setEditContent(note.content); }}
            className={`flex h-5 w-5 items-center justify-center rounded ${colors.hoverBtn} transition-colors text-[10px]`}
            aria-label="Edit"
          >
            ✏️
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMinimized(true); storeVisibility(note.id, false); onUpdate(note.id, { is_minimized: true }); }}
            className={`flex h-5 w-5 items-center justify-center rounded ${colors.hoverBtn} transition-colors text-[10px]`}
            aria-label="Minimize"
          >
            ─
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-rose-300/50 dark:hover:bg-rose-700/50 transition-colors text-[10px]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {editing ? (
          <div className="px-2 py-1.5 h-full flex flex-col">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onBlur={handleSaveContent}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleSaveContent(); }}
              autoFocus
              rows={3}
              className={`w-full flex-1 rounded border ${colors.inputBorder} ${colors.inputBg} px-2 py-1 text-xs ${colors.text} resize-none focus:outline-none focus:ring-1 focus:ring-current`}
              dir={direction}
            />
            <p className={`text-[8px] ${colors.hintText} mt-0.5`}>Ctrl+Enter to save</p>
          </div>
        ) : (
          <div
            className="px-3 py-2.5 overflow-y-auto custom-scrollbar cursor-text"
            style={{ maxHeight: size.h - 44 }}
            onDoubleClick={() => { setEditing(true); setEditContent(note.content); }}
          >
            <p className="text-xs leading-relaxed whitespace-pre-wrap">{note.content}</p>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className={`absolute bottom-0 ${direction === 'rtl' ? 'left-0' : 'right-0'} w-5 h-5 cursor-${direction === 'rtl' ? 'sw' : 'se'}-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-end ${direction === 'rtl' ? 'justify-start' : 'justify-end'}`}
        onMouseDown={handleResizeMouseDown}
        onTouchStart={handleResizeTouchStart}
        aria-label="Resize"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className={`${colors.hintText} ${direction === 'rtl' ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <line x1="11" y1="6" x2="6" y2="11" />
          <line x1="11" y1="2" x2="2" y2="11" />
        </svg>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Main Overlay Component
// -------------------------------------------------------
export default function StickyNotesOverlay() {
  const { user } = useAuthStore();
  const [notes, setNotes] = useState<StickyNoteData[]>([]);
  const [loading, setLoading] = useState(true);

  const direction = user?.locale === 'ar' ? 'rtl' as const : 'ltr' as const;

  // Fetch sticky notes via API (uses service role key, bypasses RLS)
  const fetchNotes = useCallback(async () => {
    if (!user?.id) { setNotes([]); setLoading(false); return; }
    try {
      const authHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/sticky-notes', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setNotes((data.data as StickyNoteData[]) || []);
      } else {
        console.error('Error fetching sticky notes:', res.status);
        setNotes([]);
      }
    } catch (err) {
      console.error('Fetch sticky notes error:', err);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  // Listen for custom event dispatched by StickyNoteModal for immediate appearance
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<StickyNoteData>;
      const newNote = customEvent.detail;
      if (newNote && newNote.id) {
        // Mark the new note as visible (not minimized) in localStorage
        storeVisibility(newNote.id, true);
        setNotes((prev) => {
          // Avoid duplicates (realtime might also fire)
          if (prev.some((n) => n.id === newNote.id)) return prev;
          return [...prev, newNote];
        });
      }
    };
    window.addEventListener('sticky-note-created', handler);
    return () => { window.removeEventListener('sticky-note-created', handler); };
  }, []);

  // Realtime subscription — listen for changes from other tabs/windows
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('sticky-notes-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sticky_notes', filter: `user_id=eq.${user.id}` },
        () => { fetchNotes(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, fetchNotes]);

  // Update note via API
  const handleUpdate = useCallback(async (id: string, updates: Partial<StickyNoteData>) => {
    // Optimistic
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...updates } : n));
    try {
      const authHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/sticky-notes', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ id, ...updates }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Error updating sticky note:', data.error);
      }
    } catch (err) {
      console.error('Update sticky note error:', err);
    }
  }, []);

  // Delete note via API
  const handleDelete = useCallback(async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    // Clean up localStorage for deleted note
    try { localStorage.removeItem(`${POS_PREFIX}${id}`); } catch { /* ignore */ }
    try { localStorage.removeItem(`${VIS_PREFIX}${id}`); } catch { /* ignore */ }
    try {
      const authHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/sticky-notes', {
        method: 'DELETE',
        headers: authHeaders,
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Error deleting sticky note:', data.error);
      }
    } catch (err) {
      console.error('Delete sticky note error:', err);
    }
  }, []);

  // Don't render if not authenticated or still loading
  if (!user?.id || loading) return null;

  // Don't render if no notes
  if (notes.length === 0) return null;

  return (
    <>
      {notes.map((note) => (
        <StickyNoteCard
          key={note.id}
          note={note}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          direction={direction}
        />
      ))}
    </>
  );
}
