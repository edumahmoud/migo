'use client';

import { useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';

/**
 * Landscape rotation warning overlay.
 *
 * How it works:
 * - CSS media query (`@media orientation:landscape and max-height:500px`) controls visibility
 * - This component only handles:
 *   1. Syncing the `orientation-unlocked` CSS class on <html> from localStorage
 *   2. Rendering the overlay DOM element (hidden by default, shown by CSS)
 *
 * When user disables rotation lock in Settings, `orientation-unlocked` class is added to <html>,
 * and the CSS rule stops showing the overlay.
 */
export default function LandscapeOverlay() {
  const { t, locale } = useTranslations();

  // Sync orientation-unlocked class on <html> from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('attenddo-orientation-locked');
    if (stored !== 'true') {
      document.documentElement.classList.add('orientation-unlocked');
    } else {
      document.documentElement.classList.remove('orientation-unlocked');
    }
  }, []);

  return (
    <div className="landscape-rotate-overlay" aria-hidden="true">
      <div className="rotate-phone-icon text-muted-foreground">
        <Smartphone className="h-16 w-16" strokeWidth={1.2} />
      </div>
      <p className="text-lg font-semibold text-foreground text-center">
        {locale === 'en' ? 'Please rotate your device' : 'يرجى تدوير الجهاز'}
      </p>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        {locale === 'en'
          ? 'This app works best in portrait mode'
          : 'هذا التطبيق يعمل بشكل أفضل في الوضع العمودي'}
      </p>
    </div>
  );
}
