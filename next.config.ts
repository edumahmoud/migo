import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from "next";
import path from "path";

const isVercel = process.env.VERCEL === '1';
// Optional low-memory build mode (e.g. CI sandboxes with ~4GB RAM):
// MIGO_LOW_MEM_BUILD=1 restricts webpack to a single worker and skips the
// in-build TypeScript check (types are validated separately via `tsc --noEmit`,
// because the TS checker + webpack in one worker exceeds sandbox RAM).
// Vercel builds are unaffected: they keep the full strict check.
const isLowMemBuild = process.env.MIGO_LOW_MEM_BUILD === '1';

// Content-Security-Policy in REPORT-ONLY mode: violations are reported to
// /api/csp-report but nothing is blocked. Tighten and enforce after review.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accept.paymob.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://*.googleapis.com https://accept.paymob.com https://*.paymob.com https://www.atfawry.com https://atfawry.fawrystaging.com",
  "frame-src 'self' https://accounts.google.com https://docs.google.com https://*.paymob.com https://www.atfawry.com https://atfawry.fawrystaging.com https://www.youtube.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accept.paymob.com https://www.atfawry.com",
  "frame-ancestors 'self'",
  "report-uri /api/csp-report",
].join('; ');

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7),
  },
  ...(isLowMemBuild ? { experimental: { cpus: 1 } } : {}),
  typescript: {
    // Build should fail on TypeScript errors — fix them instead of hiding them.
    // EXCEPTION: low-mem sandbox builds validate types via a separate `tsc --noEmit`
    // run (see MIGO_LOW_MEM_BUILD above) to stay within RAM limits.
    ignoreBuildErrors: isLowMemBuild,
  },
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  // CRITICAL: Do NOT add pdfjs-dist to serverExternalPackages.
  // serverExternalPackages prevents Next.js from bundling the package,
  // which means it won't be available in Vercel serverless functions.
  // Our API route uses pdfjs-dist/legacy/build/pdf.mjs via dynamic import,
  // which needs to be bundled by Next.js for Vercel deployment.
  //
  // Instead, we use outputFileTracingIncludes to ensure the legacy build
  // files are included in the serverless function output.
  outputFileTracingIncludes: {
    '/api/files/extract-pdf': [
      // Include the legacy build (designed for Node.js, no DOMMatrix dependency)
      path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
      path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      // Also include the standard build as fallback
      path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.mjs'),
      path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.mjs'),
    ],
  },
  allowedDevOrigins: [
    '.space.z.ai',
    '.z.ai',
    'localhost',
  ],
  // Proxy Socket.IO requests to the chat service on port 3003
  // Only works in local/self-hosted environments (not Vercel)
  async rewrites() {
    if (isVercel) return [];
    return [
      {
        source: '/socket.io',
        destination: 'http://localhost:3003/socket.io',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://localhost:3003/socket.io/:path*',
      },
    ];
  },
  // Set proper headers for the service worker to prevent caching and allow SW scope
  async headers() {
    return [
      {
        // Baseline security headers for every route.
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(self)' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  telemetry: false,
});
