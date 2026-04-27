import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import InstitutionHead from "@/components/shared/institution-head";
import ServiceWorkerRegistration from "@/components/shared/sw-registration";
import InstallPrompt from "@/components/shared/install-prompt";

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
  themeColor: "#059669",
};

export const metadata: Metadata = {
  title: "أتيندو",
  description: "منصة تعليمية ذكية مدعومة بالذكاء الاصطناعي للطلاب والمعلمين",
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
    title: "أتيندو",
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
        <InstitutionHead />
        <link rel="apple-touch-icon" href="/api/icon/180" data-dynamic-apple />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <ServiceWorkerRegistration />
        <InstallPrompt />
      </body>
    </html>
  );
}
