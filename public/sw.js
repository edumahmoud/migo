/// <reference lib="webworker" />

const CACHE_NAME = 'atendo-v1';
const STATIC_CACHE = 'atendo-static-v1';
const DYNAMIC_CACHE = 'atendo-dynamic-v1';
const API_CACHE = 'atendo-api-v1';

// Static assets to precache
const PRECACHE_URLS = [
  '/',
  '/offline',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/favicon.ico',
  '/logo.svg',
];

// Install event — precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Precaching static assets');
      return cache.addAll(PRECACHE_URLS);
    })
  );
  // Activate immediately without waiting
  self.skipWaiting();
});

// Activate event — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => ![STATIC_CACHE, DYNAMIC_CACHE, API_CACHE].includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  // Claim all clients immediately
  self.clients.claim();
});

// Helper: check if request is for an API call
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

// Helper: check if request is for a static asset
function isStaticAsset(url) {
  return (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff')
  );
}

// Helper: check if request is for Supabase
function isSupabaseRequest(url) {
  return url.hostname.includes('supabase.co');
}

// Fetch event — network-first for API, cache-first for static, stale-while-revalidate for pages
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests except Supabase and fonts
  if (url.origin !== self.location.origin && !isSupabaseRequest(url) && !url.hostname.includes('fonts.googleapis.com') && !url.hostname.includes('fonts.gstatic.com')) {
    return;
  }

  // Strategy: Network First for API calls
  if (isApiRequest(url)) {
    event.respondWith(
      caches.open(API_CACHE).then((cache) =>
        fetch(request)
          .then((response) => {
            // Cache successful API responses for 30 seconds
            if (response.ok) {
              const cloned = response.clone();
              cache.put(request, cloned);
            }
            return response;
          })
          .catch(() => {
            // Fallback to cache if offline
            return cache.match(request).then((cached) => {
              return cached || new Response(JSON.stringify({ error: 'أنت غير متصل بالإنترنت' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              });
            });
          })
      )
    );
    return;
  }

  // Strategy: Cache First for static assets
  if (isStaticAsset(url) || url.pathname.includes('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, cloned));
          }
          return response;
        });
      })
    );
    return;
  }

  // Strategy: Stale While Revalidate for pages and Supabase
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => {
          // If both cache and network fail, show offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/offline');
          }
          return new Response('Offline', { status: 503 });
        });

      return cached || fetchPromise;
    })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push notification support
self.addEventListener('push', (event) => {
  if (!event.data) {
    event.waitUntil(
      self.registration.showNotification('أتيندو', {
        body: 'لديك إشعار جديد',
        icon: '/api/icon/192',
        badge: '/api/icon/192',
        dir: 'rtl',
        lang: 'ar',
      })
    );
    return;
  }

  try {
    const data = event.data.json();

    // Build notification options with dynamic icon support
    const options = {
      body: data.message || 'لديك إشعار جديد',
      icon: '/api/icon/192',
      badge: '/api/icon/192',
      dir: 'rtl' as const,
      lang: 'ar',
      vibrate: [100, 50, 100],
      data: {
        url: data.url || '/',
        type: data.type || 'system',
      },
      actions: data.actions || [],
      // Android-specific: set tag to group similar notifications
      tag: data.type ? `attendo-${data.type}` : 'attendo-default',
      renotify: true,
      // Timestamp for sorting
      timestamp: Date.now(),
    };

    // Add action buttons based on notification type
    if (data.type === 'chat' || data.type === 'system') {
      options.actions = [
        { action: 'open', title: 'فتح' },
        { action: 'dismiss', title: 'تجاهل' },
      ];
    } else if (data.type === 'attendance') {
      options.actions = [
        { action: 'open', title: 'تسجيل الحضور' },
        { action: 'dismiss', title: 'لاحقاً' },
      ];
    } else if (data.type === 'assignment') {
      options.actions = [
        { action: 'open', title: 'عرض المهمة' },
        { action: 'dismiss', title: 'لاحقاً' },
      ];
    } else if (data.type === 'grade') {
      options.actions = [
        { action: 'open', title: 'عرض النتيجة' },
        { action: 'dismiss', title: 'لاحقاً' },
      ];
    }

    event.waitUntil(
      self.registration.showNotification(data.title || 'أتيندو', options)
    );
  } catch {
    event.waitUntil(
      self.registration.showNotification('أتيندو', {
        body: 'لديك إشعار جديد',
        icon: '/api/icon/192',
        badge: '/api/icon/192',
        dir: 'rtl',
        lang: 'ar',
      })
    );
  }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Handle action button clicks
  if (event.action === 'dismiss') {
    return; // User dismissed, do nothing
  }

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});

// Handle notification close (for analytics)
self.addEventListener('notificationclose', (event) => {
  // Could send analytics about dismissed notifications
  console.log('[SW] Notification closed:', event.notification.tag);
});
