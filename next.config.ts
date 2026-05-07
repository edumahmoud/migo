import type { NextConfig } from "next";
import path from "path";

const isVercel = process.env.VERCEL === '1';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true, // Pre-existing TS errors in admin-dashboard, chat route etc.
  },
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
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

export default nextConfig;
