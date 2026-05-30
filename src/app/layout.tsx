import type { Metadata, Viewport } from "next";
import React from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import InstitutionHead from "@/components/shared/institution-head";
import ServiceWorkerRegistration from "@/components/shared/sw-registration";
import InstallPrompt from "@/components/shared/install-prompt";
import SocketErrorBoundary from "@/components/shared/socket-error-boundary";
import VideoUploadIndicator from "@/components/shared/video-upload-indicator";
import FileUploadIndicator from "@/components/shared/file-upload-indicator";
import LandscapeOverlay from "@/components/shared/landscape-overlay";
import { I18nProvider } from "@/i18n/provider";
import { DirectionProvider } from "@/i18n/direction-provider";

import { SocketProvider } from "@/lib/socket";
import ClientProviders from "@/components/providers/client-providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0369a1",
};

export const metadata: Metadata = {
  title: "AttenDo | أتيندو",
  description: "Smart AI-powered educational platform for students and teachers | منصة تعليمية ذكية مدعومة بالذكاء الاصطناعي للطلاب والمعلمين",
  manifest: "/api/manifest",
  icons: {
    icon: [
      { url: "/api/icon/32", sizes: "32x32", type: "image/png" },
      { url: "/api/icon/16", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/api/icon/180", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AttenDo | أتيندو",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/api/icon/180" data-dynamic-apple />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="screen-orientation" content="portrait" />
        <meta name="x5-orientation" content="portrait" />
        {/* Pre-hydration initialization: theme + locale + white screen detection.
            ALL of these MUST run before React hydrates to prevent flash/wrong state. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // ── Theme initialization ──
              // Reads 'attendo-theme' from localStorage and applies 'dark' class immediately.
              // This prevents ThemeToggle from re-initializing on mount (which caused the
              // bug where clicking profile picture activated dark mode).
              // Do NOT check system preference — that was the bug trigger.
              (function() {
                try {
                  var theme = localStorage.getItem('attendo-theme');
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else {
                    // Default to light mode (no 'dark' class) when:
                    // - theme is 'light' explicitly
                    // - no preference stored yet
                    document.documentElement.classList.remove('dark');
                  }
                } catch(e) {}
              })();

              // ── White screen detection ──
              // Reload once if body stays empty after 12s.
              (function() {
                try {
                  var reloaded = localStorage.getItem('_wsr');
                  if (reloaded) return;
                  var start = Date.now();
                  function check() {
                    var elapsed = Date.now() - start;
                    if (window.__attendoBusyOperation) {
                      if (elapsed < 20000) requestAnimationFrame(check);
                      return;
                    }
                    try {
                      var busyRaw = localStorage.getItem('_attendo_busy');
                      if (busyRaw) {
                        var busyEntry = JSON.parse(busyRaw);
                        if (busyEntry.busy && Date.now() - busyEntry.ts < 300000) {
                          if (elapsed < 20000) requestAnimationFrame(check);
                          return;
                        }
                      }
                    } catch(e) {}
                    try {
                      var appStoreRaw = localStorage.getItem('attendo-app-store');
                      if (appStoreRaw) {
                        var appStore = JSON.parse(appStoreRaw);
                        if (appStore && appStore.state && appStore.state.currentPage && appStore.state.currentPage !== 'auth') {
                          if (elapsed < 20000) { requestAnimationFrame(check); return; }
                        }
                      }
                    } catch(e) {}
                    var body = document.body;
                    var hasContent = body && (body.children.length > 0 || body.textContent.trim().length > 0);
                    if (!hasContent && elapsed > 12000) {
                      localStorage.setItem('_wsr', '1');
                      window.location.reload();
                    } else if (elapsed < 20000) {
                      requestAnimationFrame(check);
                    }
                  }
                  requestAnimationFrame(check);
                } catch(e) {}
              })();

              // ── Locale direction initialization ──
              // Initialize locale direction from localStorage before React hydrates
              (function() {
                try {
                  var locale = localStorage.getItem('attendo-locale');
                  if (locale === '"en"' || locale === 'en') {
                    document.documentElement.lang = 'en';
                    document.documentElement.dir = 'ltr';
                  } else {
                    document.documentElement.lang = 'ar';
                    document.documentElement.dir = 'rtl';
                  }
                } catch(e) {}
              })();

              // ── Orientation lock initialization ──
              // Sync orientation-unlocked CSS class before React hydrates.
              // Prevents flash of landscape overlay on mobile devices.
              // When 'attenddo-orientation-locked' is NOT 'true', user has free rotation
              // so we add 'orientation-unlocked' class (hides the overlay).
              (function() {
                try {
                  var locked = localStorage.getItem('attenddo-orientation-locked');
                  if (locked !== 'true') {
                    document.documentElement.classList.add('orientation-unlocked');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <I18nProvider>
          <DirectionProvider>
            <ClientProviders>
            <SocketErrorBoundary
              // Slot 1 (normal): Full app WITH SocketProvider
              // Slot 2 (fallback): App WITHOUT SocketProvider — used when socket.io crashes
              fallback={
                <React.Suspense fallback={null}>
                  {children}
                </React.Suspense>
              }
            >
              <React.Suspense fallback={null}>
                <SocketProvider>
                  {children}
                </SocketProvider>
              </React.Suspense>
            </SocketErrorBoundary>
            <InstitutionHead />
            <Toaster />
            <ServiceWorkerRegistration />
            <InstallPrompt />
            <VideoUploadIndicator />
            <FileUploadIndicator />
            <LandscapeOverlay />
            </ClientProviders>
          </DirectionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
