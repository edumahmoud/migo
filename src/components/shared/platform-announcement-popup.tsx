'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PartyPopper, Megaphone, AlertTriangle, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import type { PlatformAnnouncement, PlatformAnnouncementType, PlatformAnnouncementSize } from '@/lib/types';

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

const bannerVariants = {
  hidden: { y: -100, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
  exit: {
    y: -100,
    opacity: 0,
    transition: { duration: 0.3, ease: 'easeIn' as const },
  },
};

const fullscreenVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.4, ease: 'easeOut' as const },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.3, ease: 'easeIn' as const },
  },
};

const fullscreenContentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: { duration: 0.3, ease: 'easeIn' as const },
  },
};

// -------------------------------------------------------
// Banner Display Component
// -------------------------------------------------------
function BannerDisplay({
  announcement,
  title,
  message,
  bgColor,
  direction,
  onDismiss,
  t,
}: {
  announcement: PlatformAnnouncement;
  title: string;
  message: string;
  bgColor: string;
  direction: string;
  onDismiss: () => void;
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`banner-${announcement.id}`}
        variants={bannerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed top-0 inset-x-0 z-50"
        dir={direction}
      >
        <div className={`relative bg-gradient-to-r ${bgColor} text-white shadow-lg`}>
          {/* Decorative elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <div className="absolute -top-4 -start-4 h-16 w-16 rounded-full bg-white/5 blur-xl" />
            <div className="absolute -bottom-4 -end-4 h-16 w-16 rounded-full bg-white/5 blur-xl" />
          </div>

          <div className="relative z-10 px-4 sm:px-6 py-3">
            {/* Main banner row */}
            <div className="flex items-center gap-3">
              {/* Emoji icon */}
              <span className="text-2xl sm:text-3xl flex-shrink-0" role="img" aria-label={announcement.type}>
                {announcement.icon || '📢'}
              </span>

              {/* Type badge */}
              <span
                className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize flex-shrink-0 ${getTypeBadgeStyle(announcement.type)}`}
              >
                <TypeIcon type={announcement.type} className="h-3 w-3" />
                {announcement.type}
              </span>

              {/* Title */}
              <h3 className="font-bold text-sm sm:text-base truncate flex-shrink-0">
                {title}
              </h3>

              {/* Message - truncated in collapsed state */}
              <p className={`text-white/90 text-xs sm:text-sm flex-1 min-w-0 ${expanded ? '' : 'truncate'}`}>
                {message}
              </p>

              {/* Expand/collapse button for long messages */}
              {message.length > 60 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}

              {/* Dismiss button */}
              <button
                onClick={onDismiss}
                className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white/90 hover:bg-white/25 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
                aria-label={t('common.close') || 'Close'}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Expanded content */}
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2"
              >
                {/* Full message */}
                <p className="text-white/90 text-sm leading-relaxed whitespace-pre-line">
                  {message}
                </p>

                {/* Optional image */}
                {announcement.image_url && (
                  <div className="mt-3 rounded-lg overflow-hidden max-w-sm border border-white/10">
                    <img
                      src={announcement.image_url}
                      alt={title}
                      className="w-full h-auto max-h-48 object-cover"
                    />
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// -------------------------------------------------------
// Popup Display Component (centered modal)
// -------------------------------------------------------
function PopupDisplay({
  announcement,
  title,
  message,
  bgColor,
  direction,
  onDismiss,
  t,
}: {
  announcement: PlatformAnnouncement;
  title: string;
  message: string;
  bgColor: string;
  direction: string;
  onDismiss: () => void;
  t: (key: string) => string;
}) {
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
          onClick={onDismiss}
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
          {/* Gradient header bar with icon emoji */}
          <div className={`relative bg-gradient-to-r ${bgColor} px-6 py-5`}>
            {/* Decorative blurs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute -top-8 -start-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-6 -end-6 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
            </div>

            {/* Close button */}
            <button
              onClick={onDismiss}
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

          {/* Content area */}
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

          {/* Footer with dismiss button */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
            <button
              onClick={onDismiss}
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

// -------------------------------------------------------
// Fullscreen Display Component
// -------------------------------------------------------
function FullscreenDisplay({
  announcement,
  title,
  message,
  bgColor,
  direction,
  onDismiss,
  t,
}: {
  announcement: PlatformAnnouncement;
  title: string;
  message: string;
  bgColor: string;
  direction: string;
  onDismiss: () => void;
  t: (key: string) => string;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`fullscreen-${announcement.id}`}
        variants={fullscreenVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-50"
        dir={direction}
      >
        {/* Full-screen gradient background */}
        <div className={`absolute inset-0 bg-gradient-to-br ${bgColor}`}>
          {/* Decorative background elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <div className="absolute -top-32 -start-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
            <div className="absolute -bottom-48 -end-48 h-[500px] w-[500px] rounded-full bg-white/5 blur-3xl" />
            <div className="absolute top-1/3 start-1/4 h-64 w-64 rounded-full bg-white/3 blur-2xl" />
          </div>

          {/* Close button */}
          <button
            onClick={onDismiss}
            className="absolute top-6 end-6 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm text-white/80 hover:bg-white/20 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
            aria-label={t('common.close') || 'Close'}
          >
            <X className="h-6 w-6" />
          </button>

          {/* Centered content */}
          <motion.div
            variants={fullscreenContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="relative z-10 flex flex-col items-center justify-center h-full px-6 py-12 text-center"
          >
            {/* Emoji icon — large */}
            <div className="mb-6">
              <span className="text-6xl sm:text-7xl lg:text-8xl block drop-shadow-lg" role="img" aria-label={announcement.type}>
                {announcement.icon || '🎉'}
              </span>
            </div>

            {/* Type badge */}
            <div className="mb-4 flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2">
              <TypeIcon type={announcement.type} className="h-4 w-4 text-white/90" />
              <span className="text-sm font-medium text-white/90 capitalize">
                {announcement.type}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-4 max-w-2xl drop-shadow-md">
              {title}
            </h1>

            {/* Message */}
            <p className="text-lg sm:text-xl text-white/90 leading-relaxed max-w-xl mb-8">
              {message}
            </p>

            {/* Optional image */}
            {announcement.image_url && (
              <div className="mt-2 rounded-xl overflow-hidden shadow-2xl max-w-md border border-white/10">
                <img
                  src={announcement.image_url}
                  alt={title}
                  className="w-full h-auto object-cover"
                />
              </div>
            )}

            {/* Dismiss button */}
            <button
              onClick={onDismiss}
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white/15 backdrop-blur-sm px-6 py-3 text-base font-medium text-white hover:bg-white/25 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
            >
              {t('common.dismiss') || 'Dismiss'}
            </button>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

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
        const res = await fetch('/api/platform-announcements', { cache: 'no-store' });
        if (!res.ok) {
          console.warn('[announcement-popup] API returned status:', res.status);
          return;
        }
        const result = await res.json();

        if (cancelled) return;

        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          // Filter for dashboard/everywhere announcements
          // Supports all display_size values: banner, popup, fullscreen
          const eligible = (result.data as PlatformAnnouncement[]).filter(
            (a) =>
              (a.display_location === 'dashboard' || a.display_location === 'everywhere') &&
              isWithinTimeRange(a)
          );

          console.log('[announcement-popup] Eligible announcements:', eligible.length, eligible.map(a => ({ id: a.id, size: a.display_size, location: a.display_location })));

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
      } catch (err) {
        console.warn('[announcement-popup] Fetch error:', err);
      }
    }

    fetchAnnouncements();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------
  // Dismiss handler
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
      const timer = setTimeout(() => {
        saveDismissed(announcement.id);
        setDismissed(true);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      handleDismiss();
    }, remaining);

    return () => clearTimeout(timer);
  }, [announcement, handleDismiss]);

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
  const displaySize: PlatformAnnouncementSize = announcement.display_size || 'popup';

  // ---------------------------------------------------
  // Render based on display_size
  // ---------------------------------------------------
  const sharedProps = {
    announcement,
    title,
    message,
    bgColor,
    direction,
    onDismiss: handleDismiss,
    t,
  };

  switch (displaySize) {
    case 'banner':
      return <BannerDisplay {...sharedProps} />;
    case 'fullscreen':
      return <FullscreenDisplay {...sharedProps} />;
    case 'popup':
    default:
      return <PopupDisplay {...sharedProps} />;
  }
}
