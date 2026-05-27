'use client';

import { Smartphone } from 'lucide-react';
import { useTranslations } from '@/i18n/use-translations';

/**
 * Landscape rotation warning overlay.
 *
 * How it works:
 * - CSS media query (`@media orientation:landscape and max-height:500px`) controls visibility
 * - The `orientation-unlocked` CSS class on <html> hides the overlay
 * - Class is initialized by the pre-hydration script in layout.tsx (prevents flash)
 * - Class is toggled by the settings section when user changes the orientation lock
 * - This component ONLY renders the overlay DOM element — no class manipulation
 */
export default function LandscapeOverlay() {
  const { locale } = useTranslations();

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
