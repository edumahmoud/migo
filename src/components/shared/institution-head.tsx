'use client';

import { useEffect } from 'react';
import { useInstitutionStore } from '@/stores/institution-store';
import { useTranslations } from '@/i18n/use-translations';

/**
 * InstitutionHead — dynamically updates browser tab title, favicon,
 * apple-touch-icon, and PWA meta tags based on institution data.
 *
 * When an institution uploads their logo, ALL app icons are replaced:
 * - Browser tab favicon (all sizes)
 * - Apple touch icon (home screen on iOS)
 * - PWA manifest icons (install prompt, home screen on Android)
 *
 * If no institution logo exists, the default AttenDo icons are shown.
 */
export default function InstitutionHead() {
  const { institution, fetchInstitution, loaded } = useInstitutionStore();

  useEffect(() => {
    if (!loaded) fetchInstitution();
  }, [loaded, fetchInstitution]);

  useEffect(() => {
    if (!loaded) return;

    const name = institution?.name || 'AttenDo';
    const tagline = institution?.tagline;
    const title = tagline ? `${name} - ${tagline}` : name;
    const hasLogo = !!institution?.logo_url;

    // v132d: build a stable cache-bust key from name + logo_url + tagline.
    // This changes whenever ANY of these change, which forces the browser
    // to refetch the manifest + icons. Using a stable key (instead of
    // Date.now()) means the browser can cache the manifest between
    // requests for the same institution data, but will refetch when
    // the data actually changes.
    const cacheKey = encodeURIComponent(
      `${institution?.logo_url || ''}|${name}|${tagline || ''}`
    ).slice(0, 60);

    // ─── 1. Update document title ───
    document.title = title;

    // ─── 2. Update apple-web-app title ───
    let appleWebAppMeta = document.querySelector(
      'meta[name="apple-mobile-web-app-title"]'
    ) as HTMLMetaElement | null;
    if (!appleWebAppMeta) {
      appleWebAppMeta = document.createElement('meta');
      appleWebAppMeta.name = 'apple-mobile-web-app-title';
      document.head.appendChild(appleWebAppMeta);
    }
    appleWebAppMeta.content = name;

    // ─── 3. Update application-name meta ───
    let appNameMeta = document.querySelector(
      'meta[name="application-name"]'
    ) as HTMLMetaElement | null;
    if (!appNameMeta) {
      appNameMeta = document.createElement('meta');
      appNameMeta.name = 'application-name';
      document.head.appendChild(appNameMeta);
    }
    appNameMeta.content = name;

    // ─── 4. Update favicon (all sizes) ───
    if (hasLogo) {
      // Use the dynamic icon API route — it will serve the institution logo
      const iconSizes = [
        { size: 16, href: '/api/icon/16' },
        { size: 32, href: '/api/icon/32' },
      ];

      // Remove any existing dynamic favicon links
      document
        .querySelectorAll("link[rel='icon'][data-dynamic]")
        .forEach((l) => l.remove());

      // Remove existing static favicon links too
      document
        .querySelectorAll("link[rel='icon']:not([data-dynamic])")
        .forEach((l) => l.remove());

      // v132d: use stable cache-bust key (changes when logo/name change)
      const cacheBust = `?v=${cacheKey}`;
      iconSizes.forEach(({ size, href }) => {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.setAttribute('data-dynamic', 'true');
        link.href = `${href}${cacheBust}`;
        link.type = 'image/png';
        link.sizes = `${size}x${size}`;
        document.head.appendChild(link);
      });
    } else {
      // No logo — remove dynamic links, let the default static icons show
      document
        .querySelectorAll("link[rel='icon'][data-dynamic]")
        .forEach((l) => l.remove());

      // Re-add default static favicon links if they don't exist
      const existingIcons = document.querySelectorAll("link[rel='icon']");
      if (existingIcons.length === 0) {
        const defaultLink = document.createElement('link');
        defaultLink.rel = 'icon';
        defaultLink.href = '/favicon.ico';
        defaultLink.sizes = '32x32';
        document.head.appendChild(defaultLink);
      }
    }

    // ─── 5. Update apple-touch-icon ───
    // v132d: use stable cache-bust key
    const appleIconHref = hasLogo
      ? `/api/icon/180?v=${cacheKey}`
      : '/apple-touch-icon.png';

    let appleLink = document.querySelector(
      "link[rel='apple-touch-icon']"
    ) as HTMLLinkElement | null;

    if (appleLink) {
      appleLink.href = appleIconHref;
    } else {
      appleLink = document.createElement('link');
      appleLink.rel = 'apple-touch-icon';
      appleLink.href = appleIconHref;
      appleLink.sizes = '180x180';
      document.head.appendChild(appleLink);
    }

    // ─── 6. Update manifest link (for dynamic PWA manifest) ───
    // v132d: use stable cache-bust key so the manifest refetches when
    // the institution name/logo/tagline change. This is what makes the
    // PWA name update without reinstall (the browser sees a new URL,
    // refetches the manifest, gets the new name, updates the home
    // screen icon label).
    let manifestLink = document.querySelector(
      "link[rel='manifest']"
    ) as HTMLLinkElement | null;
    if (manifestLink) {
      manifestLink.href = `/api/manifest?v=${cacheKey}`;
    }
  }, [institution, loaded]);

  return null; // This component doesn't render anything
}
