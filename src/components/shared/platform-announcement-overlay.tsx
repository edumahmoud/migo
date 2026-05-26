'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { X, PartyPopper, Megaphone, AlertTriangle, Wrench } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';
import type { PlatformAnnouncement, PlatformAnnouncementType } from '@/lib/types';

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
// Check if announcement has expired
// -------------------------------------------------------
function isExpired(announcement: PlatformAnnouncement): boolean {
  if (!announcement.end_at) return false;
  return new Date(announcement.end_at).getTime() < Date.now();
}

// -------------------------------------------------------
// Main Component: Fetches announcement and provides context
// -------------------------------------------------------
export default function PlatformAnnouncementOverlay({ children }: { children: React.ReactNode }) {
  const { locale } = useTranslations();
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

          const selected = eligible.length > 0 ? eligible[0] : null;

          if (selected) {
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
      // Already expired — dismiss via timeout to avoid synchronous setState in effect
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
  // The login page will use useLoginAnnouncement() to
  // replace the branding panel with announcement content
  // ---------------------------------------------------
  const contextValue: AnnouncementContextType = {
    announcement: (!dismissed && announcement) ? announcement : null,
    dismissed,
    handleDismiss,
  };

  return (
    <AnnouncementContext.Provider value={contextValue}>
      {children}
    </AnnouncementContext.Provider>
  );
}

// -------------------------------------------------------
// Exported helper: Announcement Branding Panel
// This replaces the default branding panel on the login page
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
        onClick={handleDismiss}
        className="absolute top-4 end-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm text-white/80 hover:bg-white/20 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="Close announcement"
      >
        <X className="h-5 w-5" />
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
