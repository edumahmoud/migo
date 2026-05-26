'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PartyPopper, Megaphone, AlertTriangle, Wrench } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import type { PlatformAnnouncement, PlatformAnnouncementType } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface PlatformAnnouncementOverlayProps {
  children: React.ReactNode; // The login form to show alongside
}

// -------------------------------------------------------
// Session storage key helper
// -------------------------------------------------------
const STORAGE_KEY = 'dismissed_platform_announcements';

function getDismissedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedId(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const current = getDismissedIds();
    current.add(id);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...current]));
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
// Check if announcement has expired
// -------------------------------------------------------
function isExpired(announcement: PlatformAnnouncement): boolean {
  if (!announcement.end_at) return false;
  return new Date(announcement.end_at).getTime() < Date.now();
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const overlayVariants = {
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

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.3, ease: 'easeIn' as const },
  },
};

const textVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.3 + i * 0.15, duration: 0.5, ease: 'easeOut' as const },
  }),
};

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function PlatformAnnouncementOverlay({ children }: PlatformAnnouncementOverlayProps) {
  const { locale, direction, isRTL } = useTranslations();
  const [announcement, setAnnouncement] = useState<PlatformAnnouncement | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

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
          const now = new Date();
          // Filter for login/everywhere announcements regardless of display_size
          // The overlay will adapt its display based on display_size
          // Note: API already filters by is_active=true, so no need to check here
          const eligible = (result.data as PlatformAnnouncement[]).filter(
            (a) =>
              (a.display_location === 'login' || a.display_location === 'everywhere') &&
              new Date(a.start_at).getTime() <= now.getTime() &&
              !isExpired(a)
          );

          // Pick the first eligible announcement
          const selected = eligible.length > 0 ? eligible[0] : null;

          if (selected) {
            // Check if dismissed in this session
            const dismissedIds = getDismissedIds();
            if (dismissedIds.has(selected.id)) {
              setDismissed(true);
            } else {
              setAnnouncement(selected);
            }
          }
        }
      } catch {
        // API may not exist yet — silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAnnouncements();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------
  // Track view (POST) once the announcement is shown
  // ---------------------------------------------------
  useEffect(() => {
    if (!announcement || dismissed) return;

    // Track the view asynchronously — fire and forget
    fetch('/api/platform-announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcement_id: announcement.id }),
    }).catch(() => {
      // Silently ignore tracking failures
    });
  }, [announcement, dismissed]);

  // ---------------------------------------------------
  // Dismiss handler
  // ---------------------------------------------------
  const handleDismiss = useCallback(() => {
    if (announcement) {
      saveDismissedId(announcement.id);
    }
    setDismissed(true);
  }, [announcement]);

  // ---------------------------------------------------
  // Auto-dismiss when end_at is reached
  // ---------------------------------------------------
  useEffect(() => {
    if (!announcement || !announcement.end_at) return;

    const remaining = new Date(announcement.end_at).getTime() - Date.now();
    if (remaining <= 0) {
      handleDismiss();
      return;
    }

    const timer = setTimeout(() => {
      handleDismiss();
    }, remaining);

    return () => clearTimeout(timer);
  }, [announcement, handleDismiss]);

  // ---------------------------------------------------
  // Determine bilingual content
  // ---------------------------------------------------
  const getTitle = useCallback(() => {
    if (!announcement) return '';
    if (locale === 'en' && announcement.title_en) return announcement.title_en;
    return announcement.title;
  }, [announcement, locale]);

  const getMessage = useCallback(() => {
    if (!announcement) return '';
    if (locale === 'en' && announcement.message_en) return announcement.message_en;
    return announcement.message;
  }, [announcement, locale]);

  // ---------------------------------------------------
  // Render: no announcement or dismissed → children only
  // ---------------------------------------------------
  if (loading) {
    // While loading, just show children (no flash of empty state)
    return <>{children}</>;
  }

  if (!announcement || dismissed) {
    return <>{children}</>;
  }

  const title = getTitle();
  const message = getMessage();
  const bgColor = announcement.bg_color || 'from-sky-700 via-sky-800 to-teal-700';
  const isFullscreen = announcement.display_size === 'fullscreen';

  // ---------------------------------------------------
  // Render: Popup-style overlay (popup/banner size on login page)
  // ---------------------------------------------------
  if (!isFullscreen) {
    return (
      <>
        {/* Login form behind the popup */}
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-background p-4 sm:p-6 lg:p-8">
          <div className="w-full max-w-md">
            {children}
          </div>
        </div>

        {/* Popup overlay */}
        <AnimatePresence mode="wait">
          <motion.div
            key={announcement.id}
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
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-labelledby="overlay-announcement-title"
              aria-describedby="overlay-announcement-message"
            >
              {/* Gradient header */}
              <div className={`relative bg-gradient-to-r ${bgColor} px-6 py-5`}>
                <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                  <div className="absolute -top-8 -start-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
                  <div className="absolute -bottom-6 -end-6 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
                </div>

                {/* Close button */}
                <button
                  onClick={handleDismiss}
                  className="absolute top-3 end-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white/90 hover:bg-white/25 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
                  aria-label="Close announcement"
                >
                  <X className="h-4 w-4" />
                </button>

                {/* Emoji icon + type badge */}
                <div className="relative z-10 flex items-center gap-3">
                  <span className="text-3xl sm:text-4xl block drop-shadow-md" role="img" aria-label={announcement.type}>
                    {announcement.icon || '📢'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize bg-white/20 text-white/90">
                    <TypeIcon type={announcement.type} className="h-3 w-3" />
                    {announcement.type}
                  </span>
                </div>
              </div>

              {/* Content area */}
              <div className="px-6 py-5 space-y-3">
                <h2
                  id="overlay-announcement-title"
                  className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight"
                >
                  {title}
                </h2>

                <p
                  id="overlay-announcement-message"
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
                  onClick={handleDismiss}
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                >
                  {isRTL ? 'إغلاق' : 'Dismiss'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </>
    );
  }

  // ---------------------------------------------------
  // Render: Full-screen announcement overlay
  // ---------------------------------------------------
  return (
    <AnimatePresence mode="wait">
      {!dismissed && announcement && (
        <motion.div
          key={announcement.id}
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 flex flex-col lg:flex-row"
          dir={direction}
        >
          {/* ------------------------------------------------ */}
          {/* Left side: Announcement content (desktop)        */}
          {/* Top section: Announcement content (mobile)        */}
          {/* ------------------------------------------------ */}
          <motion.div
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`relative flex flex-col items-center justify-center p-6 sm:p-8 lg:p-12 lg:w-1/2 bg-gradient-to-br ${bgColor} text-white overflow-hidden min-h-[40vh] lg:min-h-screen`}
          >
            {/* Decorative background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute -top-24 -start-24 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
              <div className="absolute -bottom-32 -end-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
              <div className="absolute top-1/2 start-1/4 h-48 w-48 rounded-full bg-white/3 blur-2xl" />
            </div>

            {/* Dismiss button */}
            <button
              onClick={handleDismiss}
              className="absolute top-4 end-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm text-white/80 hover:bg-white/20 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
              aria-label="Close announcement"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center text-center max-w-lg mx-auto">
              {/* Icon emoji — large display */}
              <motion.div
                custom={0}
                variants={textVariants}
                initial="hidden"
                animate="visible"
                className="mb-4 sm:mb-6"
              >
                <span className="text-5xl sm:text-6xl lg:text-7xl block drop-shadow-lg" role="img" aria-label={announcement.type}>
                  {announcement.icon || '🎉'}
                </span>
              </motion.div>

              {/* Type icon fallback (subtle) */}
              <motion.div
                custom={1}
                variants={textVariants}
                initial="hidden"
                animate="visible"
                className="mb-3 sm:mb-4 flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5"
              >
                <TypeIcon type={announcement.type} className="h-4 w-4 text-white/90" />
                <span className="text-xs sm:text-sm font-medium text-white/90 capitalize">
                  {announcement.type}
                </span>
              </motion.div>

              {/* Title */}
              <motion.h1
                custom={2}
                variants={textVariants}
                initial="hidden"
                animate="visible"
                className="text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight mb-3 sm:mb-4 drop-shadow-md"
              >
                {title}
              </motion.h1>

              {/* Message */}
              <motion.p
                custom={3}
                variants={textVariants}
                initial="hidden"
                animate="visible"
                className="text-base sm:text-lg text-white/90 leading-relaxed max-w-md"
              >
                {message}
              </motion.p>

              {/* Optional image */}
              {announcement.image_url && (
                <motion.div
                  custom={4}
                  variants={textVariants}
                  initial="hidden"
                  animate="visible"
                  className="mt-6 sm:mt-8 rounded-xl overflow-hidden shadow-2xl max-w-sm"
                >
                  <img
                    src={announcement.image_url}
                    alt={title}
                    className="w-full h-auto object-cover"
                  />
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* ------------------------------------------------ */}
          {/* Right side: Login form / children (desktop)      */}
          {/* Bottom section: Login form / children (mobile)    */}
          {/* ------------------------------------------------ */}
          <div className="flex-1 lg:w-1/2 flex items-center justify-center bg-white dark:bg-background p-4 sm:p-6 lg:p-8 min-h-[60vh] lg:min-h-screen">
            <div className="w-full max-w-md">
              {children}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
