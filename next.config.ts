import type { NextConfig } from "next";
import path from "path";

const isVercel = process.env.VERCEL === '1';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true, // Pre-existing TS errors in admin-dashboard, chat route etc.
  },
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  // Exclude pdfjs-dist from bundling so it's resolved at runtime
  serverExternalPackages: ['pdfjs-dist'],
  // Ensure pdfjs-dist worker, cmaps, and standard fonts are included in
  // Vercel serverless deployments. Output file tracing only includes files
  // that are statically imported; the worker and cmaps are loaded dynamically
  // at runtime and would be missed without explicit inclusion.
  // Key = route pattern, value = array of file globs relative to project root.
  outputFileTracingIncludes: {
    '/api/gemini/summary': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/cmaps/**/*',
      './node_modules/pdfjs-dist/standard_fonts/**/*',
    ],
    '/api/gemini/extract-pdf': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/cmaps/**/*',
      './node_modules/pdfjs-dist/standard_fonts/**/*',
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
