'use client';

import { useEffect } from 'react';
import { useInstitutionStore } from '@/stores/institution-store';

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

    const name = institution?.name || 'أتيندو';
    const tagline = institution?.tagline;
    const title = tagline ? `${name} - ${tagline}` : name;
    const hasLogo = !!institution?.logo_url;

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

      // Add dynamic favicon links (with cache-bust based on logo URL)
      const cacheBust = `?t=${Date.now()}`;
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
    const appleIconHref = hasLogo
      ? `/api/icon/180?t=${Date.now()}`
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
    // The manifest API route reads institution data from DB,
    // but we add a cache-bust param to force re-fetch when logo changes
    let manifestLink = document.querySelector(
      "link[rel='manifest']"
    ) as HTMLLinkElement | null;
    if (manifestLink) {
      if (hasLogo) {
        manifestLink.href = `/api/manifest?t=${Date.now()}`;
      } else {
        manifestLink.href = '/api/manifest';
      }
    }
  }, [institution, loaded]);

  return null; // This component doesn't render anything
}
