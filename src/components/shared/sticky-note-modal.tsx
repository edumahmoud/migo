'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  StickyNote,
  Plus,
  Palette,
  Loader2,
  X,
} from 'lucide-react';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { useTranslations } from '@/i18n/use-translations';
import { toast } from 'sonner';

type StickyColor = 'amber' | 'blue' | 'green' | 'rose' | 'purple' | 'orange';

const stickyColorMap: Record<StickyColor, { dot: string; ring: string }> = {
  amber: { dot: 'bg-amber-400', ring: 'ring-amber-600' },
  blue: { dot: 'bg-sky-400', ring: 'ring-sky-600' },
  green: { dot: 'bg-emerald-400', ring: 'ring-emerald-600' },
  rose: { dot: 'bg-rose-400', ring: 'ring-rose-600' },
  purple: { dot: 'bg-violet-400', ring: 'ring-violet-600' },
  orange: { dot: 'bg-orange-400', ring: 'ring-orange-600' },
};

const colorOptions: StickyColor[] = ['amber', 'blue', 'green', 'rose', 'purple', 'orange'];

interface StickyNoteModalProps {
  open: boolean;
  onClose: () => void;
}

export default function StickyNoteModal({ open, onClose }: StickyNoteModalProps) {
  const { t, direction } = useTranslations();
  const [content, setContent] = useState('');
  const [color, setColor] = useState<StickyColor>('amber');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!content.trim()) {
      toast.error(t('todos.stickyNoteContent'));
      return;
    }

    setCreating(true);
    try {
      const authHeaders = await getCachedAuthHeaders();
      const res = await fetch('/api/sticky-notes', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          content: content.trim(),
          color,
          position_x: Math.floor(20 + Math.random() * 100),
          position_y: Math.floor(80 + Math.random() * 80),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        console.error('Error creating sticky note:', data.error);
        toast.error(t('todos.stickyNoteCreateFailed'));
      } else {
        // Dispatch custom event so the overlay immediately adds the note
        if (data.data) {
          window.dispatchEvent(new CustomEvent('sticky-note-created', { detail: data.data }));
        }
        toast.success(t('todos.stickyNoteCreated'));
        setContent('');
        setColor('amber');
        onClose();
      }
    } catch (err) {
      console.error('Create sticky note error:', err);
      toast.error(t('todos.stickyNoteCreateFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (!creating) {
      setContent('');
      setColor('amber');
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-md rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/90 shadow-2xl overflow-hidden"
              dir={direction}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 bg-amber-200/60 dark:bg-amber-800/60 border-b border-amber-300/50 dark:border-amber-700/50">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-300/50 dark:bg-amber-700/50">
                    <StickyNote className="h-4.5 w-4.5 text-amber-700 dark:text-amber-300" />
                  </div>
                  <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">
                    {t('todos.addStickyNote')}
                  </h3>
                </div>
                <button
                  onClick={handleClose}
                  disabled={creating}
                  className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-amber-300/50 dark:hover:bg-amber-700/50 transition-colors text-amber-700 dark:text-amber-300"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-5 space-y-4">
                {/* Content textarea */}
                <div>
                  <label className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5 block">
                    {t('todos.stickyNoteContent')}
                  </label>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('todos.stickyNoteContentPlaceholder')}
                    rows={4}
                    autoFocus
                    className="w-full rounded-xl border border-amber-200 dark:border-amber-700 bg-white dark:bg-amber-900/50 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 placeholder:text-amber-400 dark:placeholder:text-amber-500 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
                    dir={direction}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        handleCreate();
                      }
                    }}
                  />
                </div>

                {/* Color picker */}
                <div>
                  <label className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2 block flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5" />
                    {t('todos.stickyNoteColor')}
                  </label>
                  <div className="flex items-center gap-2.5">
                    {colorOptions.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`h-8 w-8 rounded-full transition-all ${stickyColorMap[c].dot} ${
                          color === c
                            ? `ring-2 ring-offset-2 ${stickyColorMap[c].ring} dark:ring-offset-amber-900 scale-110`
                            : 'hover:scale-105'
                        }`}
                        aria-label={t(`todos.color${c.charAt(0).toUpperCase() + c.slice(1)}` as 'todos.colorAmber')}
                      />
                    ))}
                  </div>
                </div>

                {/* Info */}
                <div className="flex items-center gap-2 text-[11px] text-amber-600 dark:text-amber-500 bg-amber-100/50 dark:bg-amber-800/30 rounded-lg px-3 py-2">
                  <StickyNote className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('todos.stickyNotePersonalDesc')}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    onClick={handleCreate}
                    disabled={creating || !content.trim()}
                    className="flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {creating ? t('common.creating') : t('todos.addStickyNote')}
                  </button>
                  <button
                    onClick={handleClose}
                    disabled={creating}
                    className="rounded-xl bg-white/60 dark:bg-amber-800/40 px-4 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-white/80 dark:hover:bg-amber-800/60 transition-colors border border-amber-200 dark:border-amber-700/50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
