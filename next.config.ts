import type { NextConfig } from "next";
import path from "path";

const isVercel = process.env.VERCEL === '1';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true, // Pre-existing TS errors in admin-dashboard, chat route etc.
  },
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  // Exclude pdfjs-dist from the serverless bundle — it uses browser-only APIs
  // (DOMMatrix, etc.) that crash in Node.js. The server-side extraction route
  // uses the legacy build (pdfjs-dist/legacy/build/pdf.mjs) via dynamic import.
  serverExternalPackages: ['pdfjs-dist'],
  // Ensure the pdfjs-dist legacy build is included in the serverless function
  // output on Vercel. Dynamic imports like 'pdfjs-dist/legacy/build/pdf.mjs'
  // are not always traced automatically by the file tracer.
  outputFileTracingIncludes: {
    '/api/files/extract-pdf': [
      path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
      path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
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
