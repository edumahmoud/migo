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
        {/* Theme initialization: MUST run before React hydrates to prevent flash.
            Reads 'attendo-theme' from localStorage and applies 'dark' class immediately.
            This prevents the ThemeToggle component from re-initializing on mount. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('attendo-theme');
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else {
                    // Default to light mode when no preference is stored
                    document.documentElement.classList.remove('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
        {/* White screen detection: reload once if body stays empty after 12s.
            FIX v2: Uses localStorage instead of sessionStorage (survives process kills).
            Also checks localStorage _attendo_busy flag — Android process kills lose the
            window.__attendoBusyOperation JS variable, but localStorage persists.
            Increased timeout from 8s to 12s to avoid false positives on slow mobile.
            Also checks if there's a persisted session in localStorage — if so, don't
            reload (the app is just taking time to hydrate after process restore). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var reloaded = localStorage.getItem('_wsr');
                  if (reloaded) return;
                  var start = Date.now();
                  function check() {
                    var elapsed = Date.now() - start;
                    // FIX: Check BOTH window variable AND localStorage busy flag
                    // (localStorage survives Android process kills, window var doesn't)
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
                    // FIX: Also check if there's a persisted session — if so, the app
                    // is hydrating after process restore, not stuck. Don't reload.
                    try {
                      var appStoreRaw = localStorage.getItem('attendo-app-store');
                      if (appStoreRaw) {
                        var appStore = JSON.parse(appStoreRaw);
                        if (appStore && appStore.state && appStore.state.currentPage && appStore.state.currentPage !== 'auth') {
                          // User was logged in — app is hydrating, not stuck. Give it more time.
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

              // Initialize locale direction from localStorage before React hydrates
              // This prevents the flash of wrong direction
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

              // Initialize theme from localStorage before React hydrates
              // This prevents dark mode from being activated unexpectedly
              // when ThemeToggle mounts for the first time (e.g., dropdown opens).
              // Without this, ThemeToggle would check system preference and
              // potentially add the 'dark' class even if the user was in light mode.
              (function() {
                try {
                  var theme = localStorage.getItem('attendo-theme');
                  if (theme === 'dark') {
                    document.documentElement.classList.add('dark');
                  } else if (theme === 'light') {
                    // Explicitly light — ensure dark class is removed
                    document.documentElement.classList.remove('dark');
                  }
                  // If no theme stored yet, default to light (no 'dark' class).
                  // Do NOT check system preference here — that caused the bug
                  // where clicking the profile picture activated dark mode.
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
          </DirectionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
