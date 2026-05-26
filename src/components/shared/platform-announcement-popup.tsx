'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PartyPopper, Megaphone, AlertTriangle, Wrench } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import type { PlatformAnnouncement, PlatformAnnouncementType } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface PlatformAnnouncementPopupProps {
  userId?: string;
}

// -------------------------------------------------------
// LocalStorage dismiss helpers
// -------------------------------------------------------
function getDismissedKey(id: string): string {
  return `platform_announcement_dismissed_${id}`;
}

function isDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(getDismissedKey(id)) === 'true';
  } catch {
    return false;
  }
}

function saveDismissed(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getDismissedKey(id), 'true');
  } catch {
    // Silently ignore storage errors
  }
}

// -------------------------------------------------------
// Type-based icon component
// -------------------------------------------------------
function TypeIcon({ type, className }: { type: PlatformAnnouncementType; className?: string }) {
  switch (type) {
    case 'celebration':
      return <PartyPopper className={className} />;
    case 'announcement':
      return <Megaphone className={className} />;
    case 'alert':
      return <AlertTriangle className={className} />;
    case 'maintenance':
      return <Wrench className={className} />;
    default:
      return <Megaphone className={className} />;
  }
}

// -------------------------------------------------------
// Type badge color mapping
// -------------------------------------------------------
function getTypeBadgeStyle(type: PlatformAnnouncementType): string {
  switch (type) {
    case 'celebration':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    case 'announcement':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300';
    case 'alert':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
    case 'maintenance':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300';
  }
}

// -------------------------------------------------------
// Check if announcement is within active time range
// -------------------------------------------------------
function isWithinTimeRange(announcement: PlatformAnnouncement): boolean {
  const now = Date.now();
  const start = new Date(announcement.start_at).getTime();
  if (start > now) return false;
  if (announcement.end_at) {
    const end = new Date(announcement.end_at).getTime();
    if (end < now) return false;
  }
  return true;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' as const },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.2, ease: 'easeIn' as const },
  },
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.2, ease: 'easeIn' as const },
  },
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function PlatformAnnouncementPopup({ userId }: PlatformAnnouncementPopupProps) {
  const { t, locale, direction } = useTranslations();
  const [announcement, setAnnouncement] = useState<PlatformAnnouncement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // ---------------------------------------------------
  // Fetch active announcements on mount
  // ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function fetchAnnouncements() {
      try {
        const res = await fetch('/api/platform-announcements');
        if (!res.ok) return;
        const result = await res.json();

        if (cancelled) return;

        if (result.success && Array.isArray(result.data)) {
          // Filter for dashboard/everywhere announcements regardless of display_size
          // The popup always shows as a popup on the dashboard
          // Note: API already filters by is_active=true, so no need to check here
          const eligible = (result.data as PlatformAnnouncement[]).filter(
            (a) =>
              (a.display_location === 'dashboard' || a.display_location === 'everywhere') &&
              isWithinTimeRange(a)
          );

          // Pick the first non-dismissed eligible announcement
          for (const candidate of eligible) {
            if (!isDismissed(candidate.id)) {
              if (!cancelled) {
                setAnnouncement(candidate);
              }
              return;
            }
          }
        }
      } catch {
        // API may not exist yet — silently ignore
      }
    }

    fetchAnnouncements();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------
  // Dismiss handler (declared before effects that use it)
  // ---------------------------------------------------
  const handleDismiss = useCallback(() => {
    if (announcement) {
      saveDismissed(announcement.id);
    }
    setDismissed(true);
  }, [announcement]);

  // ---------------------------------------------------
  // Track view (POST) once the announcement is shown
  // ---------------------------------------------------
  useEffect(() => {
    if (!announcement || dismissed) return;

    // Track the view asynchronously — fire and forget
    fetch('/api/platform-announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        announcement_id: announcement.id,
        user_id: userId || null,
      }),
    }).catch(() => {
      // Silently ignore tracking failures
    });
  }, [announcement, dismissed, userId]);

  // ---------------------------------------------------
  // Auto-dismiss when end_at is reached
  // ---------------------------------------------------
  useEffect(() => {
    if (!announcement || !announcement.end_at) return;

    const remaining = new Date(announcement.end_at).getTime() - Date.now();
    if (remaining <= 0) {
      // Announcement already expired — this is handled by isWithinTimeRange during fetch,
      // but as a safety net, trigger dismiss asynchronously via setTimeout(0)
      const timer = setTimeout(() => {
        saveDismissed(announcement.id);
        setDismissed(true);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      saveDismissed(announcement.id);
      setDismissed(true);
    }, remaining);

    return () => clearTimeout(timer);
  }, [announcement]);

  // ---------------------------------------------------
  // Determine bilingual content
  // ---------------------------------------------------
  const getTitle = useCallback((): string => {
    if (!announcement) return '';
    if (locale === 'en' && announcement.title_en) return announcement.title_en;
    return announcement.title;
  }, [announcement, locale]);

  const getMessage = useCallback((): string => {
    if (!announcement) return '';
    if (locale === 'en' && announcement.message_en) return announcement.message_en;
    return announcement.message;
  }, [announcement, locale]);

  // ---------------------------------------------------
  // Nothing to show
  // ---------------------------------------------------
  if (!announcement || dismissed) {
    return null;
  }

  const title = getTitle();
  const message = getMessage();
  const bgColor = announcement.bg_color || 'from-sky-600 via-sky-700 to-teal-600';

  // ---------------------------------------------------
  // Render: Popup announcement modal
  // ---------------------------------------------------
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`popup-overlay-${announcement.id}`}
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        dir={direction}
      >
        {/* Background overlay */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={handleDismiss}
          aria-hidden="true"
        />

        {/* Popup card */}
        <motion.div
          key={`popup-card-${announcement.id}`}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="popup-announcement-title"
          aria-describedby="popup-announcement-message"
        >
          {/* ----------------------------------------------- */}
          {/* Gradient header bar with icon emoji             */}
          {/* ----------------------------------------------- */}
          <div className={`relative bg-gradient-to-r ${bgColor} px-6 py-5`}>
            {/* Decorative blurs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute -top-8 -start-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-6 -end-6 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
            </div>

            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 end-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white/90 hover:bg-white/25 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
              aria-label={t('common.close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>

            {/* Emoji icon + type badge */}
            <div className="relative z-10 flex items-center gap-3">
              <span className="text-3xl sm:text-4xl block drop-shadow-md" role="img" aria-label={announcement.type}>
                {announcement.icon || '📢'}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${getTypeBadgeStyle(announcement.type)}`}
              >
                <TypeIcon type={announcement.type} className="h-3 w-3" />
                {announcement.type}
              </span>
            </div>
          </div>

          {/* ----------------------------------------------- */}
          {/* Content area                                     */}
          {/* ----------------------------------------------- */}
          <div className="px-6 py-5 space-y-3">
            {/* Title */}
            <h2
              id="popup-announcement-title"
              className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight"
            >
              {title}
            </h2>

            {/* Message */}
            <p
              id="popup-announcement-message"
              className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line"
            >
              {message}
            </p>

            {/* Optional image */}
            {announcement.image_url && (
              <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                <img
                  src={announcement.image_url}
                  alt={title}
                  className="w-full h-auto max-h-64 object-cover"
                />
              </div>
            )}
          </div>

          {/* ----------------------------------------------- */}
          {/* Footer with dismiss button                       */}
          {/* ----------------------------------------------- */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
            <button
              onClick={handleDismiss}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            >
              {t('common.dismiss') || 'Dismiss'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
