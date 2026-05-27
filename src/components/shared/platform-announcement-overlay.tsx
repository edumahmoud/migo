'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PartyPopper, Megaphone, AlertTriangle, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import type { PlatformAnnouncement, PlatformAnnouncementType, PlatformAnnouncementSize } from '@/lib/types';

// -------------------------------------------------------
// Context: Share the active announcement with the login page
// -------------------------------------------------------
interface AnnouncementContextType {
  announcement: PlatformAnnouncement | null;
  dismissed: boolean;
  handleDismiss: () => void;
}

const AnnouncementContext = createContext<AnnouncementContextType>({
  announcement: null,
  dismissed: false,
  handleDismiss: () => {},
});

export function useLoginAnnouncement() {
  return useContext(AnnouncementContext);
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
// Check if announcement has expired
// -------------------------------------------------------
function isExpired(announcement: PlatformAnnouncement): boolean {
  if (!announcement.end_at) return false;
  return new Date(announcement.end_at).getTime() < Date.now();
}

// -------------------------------------------------------
// Animation variants for login page overlays
// -------------------------------------------------------
const loginBannerVariants = {
  hidden: { y: -100, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    y: -100,
    opacity: 0,
    transition: { duration: 0.3, ease: 'easeIn' as const },
  },
};

const loginPopupOverlayVariants = {
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

const loginPopupCardVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 10,
    transition: { duration: 0.2, ease: 'easeIn' as const },
  },
};

// -------------------------------------------------------
// Main Component: Fetches announcement and provides context
// -------------------------------------------------------
export default function PlatformAnnouncementOverlay({ children }: { children: React.ReactNode }) {
  const { locale, direction } = useTranslations();
  const [announcement, setAnnouncement] = useState<PlatformAnnouncement | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);

  // ---------------------------------------------------
  // Fetch active announcements on mount
  // ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function fetchAnnouncements() {
      try {
        const res = await fetch('/api/platform-announcements', { cache: 'no-store' });
        if (!res.ok) return;
        const result = await res.json();

        if (cancelled) return;

        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
          const now = new Date();
          const eligible = (result.data as PlatformAnnouncement[]).filter(
            (a) =>
              (a.display_location === 'login' || a.display_location === 'everywhere') &&
              new Date(a.start_at).getTime() <= now.getTime() &&
              !isExpired(a)
          );

          console.log('[announcement-overlay] Eligible announcements:', eligible.length, eligible.map(a => ({ id: a.id, size: a.display_size, location: a.display_location })));

          // Iterate through all eligible announcements to find the first non-dismissed one
          // (previously only checked the first, which meant subsequent announcements were hidden)
          const dismissedIds = getDismissedIds();
          let found = false;
          for (const candidate of eligible) {
            if (dismissedIds.has(candidate.id)) {
              continue; // Skip dismissed, check next
            }
            setAnnouncement(candidate);
            found = true;
            break;
          }
          if (!found && eligible.length > 0) {
            // All eligible announcements were dismissed
            setDismissed(true);
          }
        }
      } catch (err) {
        console.warn('[announcement-overlay] Fetch error:', err);
      }
    }

    fetchAnnouncements();
    return () => { cancelled = true; };
  }, []);

  // ---------------------------------------------------
  // Track view (POST) once the announcement is shown
  // ---------------------------------------------------
  useEffect(() => {
    if (!announcement || dismissed) return;

    fetch('/api/platform-announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ announcement_id: announcement.id }),
    }).catch(() => {});
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
      const timer = setTimeout(() => {
        saveDismissedId(announcement.id);
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
  // Provide context + render children (the login page)
  // ---------------------------------------------------
  const contextValue: AnnouncementContextType = {
    announcement: (!dismissed && announcement) ? announcement : null,
    dismissed,
    handleDismiss,
  };

  const displaySize: PlatformAnnouncementSize = announcement?.display_size || 'fullscreen';
  const isActive = !dismissed && !!announcement;

  // ---------------------------------------------------
  // For fullscreen: the login page uses useLoginAnnouncement()
  // to replace the branding panel with announcement content.
  // Additionally, we render a standalone fullscreen overlay that
  // is visible on ALL screen sizes (the branding panel is hidden
  // on mobile via `hidden lg:flex`, so mobile users would never
  // see fullscreen announcements without this overlay).
  // For banner/popup: we render additional overlays on top.
  // ---------------------------------------------------
  return (
    <AnnouncementContext.Provider value={contextValue}>
      {/* Banner display: sticky top banner above the login form */}
      {isActive && displaySize === 'banner' && announcement && (
        <LoginBannerAnnouncement
          announcement={announcement}
          title={getTitle()}
          message={getMessage()}
          direction={direction}
          onDismiss={handleDismiss}
        />
      )}

      {/* Popup display: centered modal overlay */}
      {isActive && displaySize === 'popup' && announcement && (
        <LoginPopupAnnouncement
          announcement={announcement}
          title={getTitle()}
          message={getMessage()}
          direction={direction}
          onDismiss={handleDismiss}
        />
      )}

      {/* Fullscreen display: true fullscreen overlay (visible on all screens) */}
      {isActive && displaySize === 'fullscreen' && announcement && (
        <LoginFullscreenAnnouncement
          announcement={announcement}
          title={getTitle()}
          message={getMessage()}
          direction={direction}
          onDismiss={handleDismiss}
        />
      )}

      {children}
    </AnnouncementContext.Provider>
  );
}

// -------------------------------------------------------
// Login Page Banner (top bar)
// -------------------------------------------------------
function LoginBannerAnnouncement({
  announcement,
  title,
  message,
  direction,
  onDismiss,
}: {
  announcement: PlatformAnnouncement;
  title: string;
  message: string;
  direction: string;
  onDismiss: () => void;
}) {
  const bgColor = announcement.bg_color || 'from-sky-600 via-sky-700 to-teal-600';
  const [expanded, setExpanded] = useState(false);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`login-banner-${announcement.id}`}
        variants={loginBannerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="sticky top-0 z-50"
        dir={direction}
      >
        <div className={`relative bg-gradient-to-r ${bgColor} text-white shadow-lg`}>
          {/* Decorative elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
            <div className="absolute -top-4 -start-4 h-16 w-16 rounded-full bg-white/5 blur-xl" />
            <div className="absolute -bottom-4 -end-4 h-16 w-16 rounded-full bg-white/5 blur-xl" />
          </div>

          <div className="relative z-10 px-4 sm:px-6 py-3">
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

              {/* Message */}
              <p className={`text-white/90 text-xs sm:text-sm flex-1 min-w-0 ${expanded ? '' : 'truncate'}`}>
                {message}
              </p>

              {/* Expand/collapse button */}
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
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
                aria-label="Close announcement"
              >
                <X className="h-4 w-4" />
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
                <p className="text-white/90 text-sm leading-relaxed whitespace-pre-line">
                  {message}
                </p>
                {announcement.image_url && (
                  <div className="mt-3 rounded-lg overflow-hidden max-w-sm border border-white/10">
                    <img src={announcement.image_url} alt={title} className="w-full h-auto max-h-48 object-cover" />
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
// Login Page Popup (centered modal)
// -------------------------------------------------------
function LoginPopupAnnouncement({
  announcement,
  title,
  message,
  direction,
  onDismiss,
}: {
  announcement: PlatformAnnouncement;
  title: string;
  message: string;
  direction: string;
  onDismiss: () => void;
}) {
  const bgColor = announcement.bg_color || 'from-sky-600 via-sky-700 to-teal-600';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`login-popup-overlay-${announcement.id}`}
        variants={loginPopupOverlayVariants}
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
          key={`login-popup-card-${announcement.id}`}
          variants={loginPopupCardVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative z-10 w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-popup-title"
          aria-describedby="login-popup-message"
        >
          {/* Gradient header */}
          <div className={`relative bg-gradient-to-r ${bgColor} px-6 py-5`}>
            <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
              <div className="absolute -top-8 -start-8 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-6 -end-6 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="absolute top-3 end-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

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

          {/* Content */}
          <div className="px-6 py-5 space-y-3">
            <h2 id="login-popup-title" className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {title}
            </h2>
            <p id="login-popup-message" className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
              {message}
            </p>
            {announcement.image_url && (
              <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                <img src={announcement.image_url} alt={title} className="w-full h-auto max-h-64 object-cover" />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 cursor-pointer"
            >
             Dismiss
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// -------------------------------------------------------
// Login Page Fullscreen (true fullscreen overlay on all screens)
// This is critical for mobile — the branding panel is `hidden lg:flex`,
// so fullscreen announcements were completely invisible on mobile before.
// -------------------------------------------------------
const loginFullscreenVariants = {
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

const loginFullscreenContentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: { duration: 0.3, ease: 'easeIn' as const },
  },
};

function LoginFullscreenAnnouncement({
  announcement,
  title,
  message,
  direction,
  onDismiss,
}: {
  announcement: PlatformAnnouncement;
  title: string;
  message: string;
  direction: string;
  onDismiss: () => void;
}) {
  const bgColor = announcement.bg_color || 'from-sky-700 via-sky-800 to-teal-700';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`login-fullscreen-${announcement.id}`}
        variants={loginFullscreenVariants}
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
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="absolute top-4 end-4 z-[100] flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
            aria-label="Close announcement"
          >
            <X className="h-6 w-6" />
          </button>

          {/* Centered content */}
          <motion.div
            variants={loginFullscreenContentVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="relative z-10 flex flex-col items-center justify-center h-full px-6 py-12 text-center"
          >
            {/* Emoji icon — large */}
            <div className="mb-4 sm:mb-6">
              <span className="text-5xl sm:text-6xl lg:text-8xl block drop-shadow-lg" role="img" aria-label={announcement.type}>
                {announcement.icon || '🎉'}
              </span>
            </div>

            {/* Type badge */}
            <div className="mb-3 sm:mb-4 flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5">
              <TypeIcon type={announcement.type} className="h-4 w-4 text-white/90" />
              <span className="text-xs sm:text-sm font-medium text-white/90 capitalize">
                {announcement.type}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl lg:text-5xl font-bold text-white leading-tight mb-3 sm:mb-4 max-w-2xl drop-shadow-md">
              {title}
            </h1>

            {/* Message */}
            <p className="text-sm sm:text-lg lg:text-xl text-white/90 leading-relaxed max-w-xl">
              {message}
            </p>

            {/* Optional image */}
            {announcement.image_url && (
              <div className="mt-4 sm:mt-6 rounded-xl overflow-hidden shadow-2xl max-w-md border border-white/10">
                <img
                  src={announcement.image_url}
                  alt={title}
                  className="w-full h-auto object-cover"
                />
              </div>
            )}

            {/* Dismiss button */}
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="mt-6 sm:mt-8 inline-flex items-center gap-2 rounded-xl bg-white/20 backdrop-blur-sm px-6 py-3 text-sm sm:text-base font-medium text-white hover:bg-white/30 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
            >
             Dismiss
            </button>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// -------------------------------------------------------
// Exported helper: Announcement Branding Panel
// This replaces the default branding panel on the login page
// Used for display_size === 'fullscreen' (or when display_size is not specified)
// NOTE: This is only visible on desktop (lg+ screens) because the
// branding panel has `hidden lg:flex`. On mobile, the
// LoginFullscreenAnnouncement overlay is shown instead.
// -------------------------------------------------------
export function AnnouncementBrandingPanel() {
  const { announcement, handleDismiss } = useLoginAnnouncement();
  const { locale, direction } = useTranslations();

  if (!announcement) return null;

  const title = locale === 'en' && announcement.title_en ? announcement.title_en : announcement.title;
  const message = locale === 'en' && announcement.message_en ? announcement.message_en : announcement.message;
  const bgColor = announcement.bg_color || 'from-sky-700 via-sky-800 to-teal-700';

  return (
    <div
      className={`relative flex flex-col items-center justify-center p-6 sm:p-8 lg:p-12 bg-gradient-to-br ${bgColor} text-white overflow-hidden h-full w-full`}
      dir={direction}
    >
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-24 -start-24 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -end-32 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute top-1/2 start-1/4 h-48 w-48 rounded-full bg-white/3 blur-2xl" />
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
        className="absolute top-4 end-4 z-[100] flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white hover:bg-white/30 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 cursor-pointer"
        aria-label="Close announcement"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-lg mx-auto">
        {/* Icon emoji — large display */}
        <div className="mb-4 sm:mb-6">
          <span className="text-5xl sm:text-6xl lg:text-7xl block drop-shadow-lg" role="img" aria-label={announcement.type}>
            {announcement.icon || '🎉'}
          </span>
        </div>

        {/* Type icon fallback (subtle) */}
        <div className="mb-3 sm:mb-4 flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1.5">
          <TypeIcon type={announcement.type} className="h-4 w-4 text-white/90" />
          <span className="text-xs sm:text-sm font-medium text-white/90 capitalize">
            {announcement.type}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight mb-3 sm:mb-4 drop-shadow-md">
          {title}
        </h1>

        {/* Message */}
        <p className="text-base sm:text-lg text-white/90 leading-relaxed max-w-md">
          {message}
        </p>

        {/* Optional image */}
        {announcement.image_url && (
          <div className="mt-6 sm:mt-8 rounded-xl overflow-hidden shadow-2xl max-w-sm">
            <img
              src={announcement.image_url}
              alt={title}
              className="w-full h-auto object-cover"
            />
          </div>
        )}
      </div>
    </div>
  );
}
