'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Megaphone, X, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import type { Announcement } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface AnnouncementsBannerProps {
  userId: string;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const slideDown = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2, ease: 'easeIn' } },
};

// -------------------------------------------------------
// Priority styling
// -------------------------------------------------------
function getPriorityStyle(priority: string) {
  switch (priority) {
    case 'urgent':
      return {
        bg: 'bg-rose-50 border-rose-200',
        icon: <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />,
        title: 'text-rose-700',
      };
    case 'high':
      return {
        bg: 'bg-amber-50 border-amber-200',
        icon: <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />,
        title: 'text-amber-700',
      };
    case 'low':
      return {
        bg: 'bg-gray-50 border-gray-200',
        icon: <Info className="h-4 w-4 text-gray-600 shrink-0" />,
        title: 'text-gray-700',
      };
    default:
      return {
        bg: 'bg-emerald-50 border-emerald-200',
        icon: <Megaphone className="h-4 w-4 text-emerald-600 shrink-0" />,
        title: 'text-emerald-700',
      };
  }
}

// -------------------------------------------------------
// SessionStorage helper for dismiss state
// -------------------------------------------------------
function getDismissedSet(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const key = `dismissed_announcements_${userId}`;
    const stored = sessionStorage.getItem(key);
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedSet(userId: string, dismissed: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    const key = `dismissed_announcements_${userId}`;
    sessionStorage.setItem(key, JSON.stringify([...dismissed]));
  } catch {
    // ignore
  }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function AnnouncementsBanner({ userId }: AnnouncementsBannerProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissedSet(userId));

  useEffect(() => {
    fetch('/api/announcements')
      .then((res) => res.json())
      .then((result) => {
        if (result.success && result.data) {
          setAnnouncements(result.data as Announcement[]);
        }
      })
      .catch(() => {
        // Table may not exist or API failure — silently ignore
      });
  }, []);

  const visibleAnnouncements = announcements.filter((a) => !dismissed.has(a.id));

  // Auto-rotate carousel every 5 seconds when there are multiple announcements
  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % visibleAnnouncements.length);
  }, [visibleAnnouncements.length]);

  useEffect(() => {
    if (visibleAnnouncements.length <= 1) return;
    const timer = setInterval(handleNext, 5000);
    return () => clearInterval(timer);
  }, [visibleAnnouncements.length, handleNext]);

  const handleDismiss = (id: string) => {
    const newDismissed = new Set(dismissed);
    newDismissed.add(id);
    setDismissed(newDismissed);
    saveDismissedSet(userId, newDismissed);
    // Adjust index if needed
    const remaining = visibleAnnouncements.filter((a) => a.id !== id);
    if (remaining.length > 0 && currentIndex >= remaining.length) {
      setCurrentIndex(0);
    }
  };

  if (visibleAnnouncements.length === 0) return null;

  const current = visibleAnnouncements[currentIndex % visibleAnnouncements.length] || visibleAnnouncements[0];
  if (!current) return null;

  const style = getPriorityStyle(current.priority);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={current.id}
        variants={slideDown}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={`rounded-xl border ${style.bg} p-3 sm:p-4`}
        dir="rtl"
      >
        <div className="flex items-start gap-3">
          {style.icon}
          <div className="min-w-0 flex-1">
            <h4 className={`text-sm font-bold ${style.title}`}>{current.title}</h4>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{current.content}</p>
          </div>
          <button
            onClick={() => handleDismiss(current.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/50 transition-colors"
            aria-label="إغلاق"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {visibleAnnouncements.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-2">
            {visibleAnnouncements.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === currentIndex % visibleAnnouncements.length
                    ? 'w-4 bg-emerald-500'
                    : 'w-1.5 bg-emerald-300'
                }`}
                aria-label={`الإعلان ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
