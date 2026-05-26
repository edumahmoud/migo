// =====================================================
// Shared Platform Announcements Cache
// =====================================================
// This module provides a shared in-memory cache for platform announcements.
// Both the public API and admin API routes import from this module so that
// admin mutations (create/update/delete/toggle) can invalidate the cache
// that the public API reads from.

let cache: { data: unknown[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

export function getCache(): { data: unknown[]; timestamp: number } | null {
  return cache;
}

export function setCache(data: unknown[]): void {
  cache = { data, timestamp: Date.now() };
}

export function isCacheValid(): boolean {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS;
}

export function invalidateCache(): void {
  cache = null;
}
