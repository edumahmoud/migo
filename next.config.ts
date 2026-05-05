import type { NextConfig } from "next";
import path from "path";

const isVercel = process.env.VERCEL === '1';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true, // Pre-existing TS errors in admin-dashboard, chat route etc.
  },
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  // pdf-parse MUST be external — its internal dynamic require('./pdf.js/${version}/build/pdf.js')
  // cannot be bundled by webpack. We load it via createRequire() at runtime.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  // CRITICAL for Vercel: Ensure pdf-parse's ENTIRE directory is included in
  // the serverless function. Vercel's file tracing only detects statically
  // imported files, but pdf-parse loads its internal pdf.js dynamically.
  // Without this, the module exists but its internal files are missing.
  outputFileTracingIncludes: {
    // Include pdf-parse in all routes that use PDF extraction
    '/api/gemini/summary': ['./node_modules/pdf-parse/**/*'],
    '/api/gemini/extract-pdf': ['./node_modules/pdf-parse/**/*'],
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
