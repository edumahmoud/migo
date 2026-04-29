/// <reference lib="webworker" />

const CACHE_NAME = 'atendo-v2';
const STATIC_CACHE = 'atendo-static-v2';
const DYNAMIC_CACHE = 'atendo-dynamic-v2';
const API_CACHE = 'atendo-api-v2';

// Build version — update this comment to force SW cache bust
// BUILD_VERSION: 2.0.0

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

// ─── Install ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      console.log('[SW] Precaching static assets');
      for (const url of PRECACHE_URLS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] Failed to precache:', url, err);
        }
      }
    })
  );
  self.skipWaiting();
});

// ─── Activate ─── Clean up old caches + dynamic cache
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
    }).then(() => self.clients.claim())
  );
});

// ─── Helpers ───
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

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

function isSupabaseRequest(url) {
  return url.hostname.includes('supabase.co');
}

function isHtmlPage(request) {
  return (
    request.mode === 'navigate' ||
    request.headers.get('accept')?.includes('text/html')
  );
}

// ─── Offline fallback ───
async function getOfflinePage() {
  const cached = await caches.match('/offline');
  if (cached) return cached;
  // Fallback if offline page not cached
  return new Response(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>لا يوجد اتصال</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4;text-align:center;direction:rtl}h1{color:#065f46}p{color:#374151}</style></head><body><div><h1>لا يوجد اتصال</h1><p>تحقق من اتصالك بالإنترنت وحاول مرة أخرى.</p></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ─── Fetch ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin except Supabase & fonts
  if (
    url.origin !== self.location.origin &&
    !isSupabaseRequest(url) &&
    !url.hostname.includes('fonts.googleapis.com') &&
    !url.hostname.includes('fonts.gstatic.com')
  ) {
    return;
  }

  // ─── Strategy: Network First for API ───
  if (isApiRequest(url)) {
    event.respondWith(
      caches.open(API_CACHE).then((cache) =>
        fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => {
            return cache.match(request).then((cached) => {
              return (
                cached ||
                new Response(
                  JSON.stringify({ error: 'أنت غير متصل بالإنترنت' }),
                  {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' },
                  }
                )
              );
            });
          })
      )
    );
    return;
  }

  // ─── Strategy: Cache First for static assets ───
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

  // ─── Strategy: Network First for HTML pages ───
  // This prevents serving stale HTML that references deleted JS chunks
  if (isHtmlPage(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, cloned));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || getOfflinePage();
          });
        })
    );
    return;
  }

  // ─── Strategy: Stale While Revalidate for everything else ───
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
          return new Response('Offline', { status: 503 });
        });

      return cached || fetchPromise;
    })
  );
});

// ─── Messages ───
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Push Notifications ───
self.addEventListener('push', (event) => {
  if (!event.data) {
    event.waitUntil(
      self.registration.showNotification('أتيندو', {
        body: 'لديك إشعار جديد',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        dir: 'rtl',
        lang: 'ar',
      })
    );
    return;
  }

  try {
    const data = event.data.json();
    const options = {
      body: data.message || 'لديك إشعار جديد',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [100, 50, 100],
      data: {
        url: data.url || '/',
        type: data.type || 'system',
      },
      actions: data.actions || [],
      tag: data.id ? `attendo-${data.id}` : `attendo-${data.type || 'default'}-${Date.now()}`,
      renotify: true,
      timestamp: Date.now(),
    };

    if (data.type === 'chat') {
      options.actions = [
        { action: 'open', title: 'فتح المحادثة' },
        { action: 'dismiss', title: 'تجاهل' },
      ];
    } else if (data.type === 'system') {
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
    } else if (data.type === 'file') {
      options.actions = [
        { action: 'open', title: 'عرض الملف' },
        { action: 'dismiss', title: 'لاحقاً' },
      ];
    } else if (data.type === 'enrollment') {
      options.actions = [
        { action: 'open', title: 'عرض' },
        { action: 'dismiss', title: 'تجاهل' },
      ];
    } else if (data.type === 'lecture') {
      options.actions = [
        { action: 'open', title: 'عرض المحاضرة' },
        { action: 'dismiss', title: 'لاحقاً' },
      ];
    } else if (data.type === 'link_request') {
      options.actions = [
        { action: 'open', title: 'عرض الطلب' },
        { action: 'dismiss', title: 'لاحقاً' },
      ];
    } else if (data.type === 'file_request') {
      options.actions = [
        { action: 'open', title: 'عرض الطلب' },
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
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        dir: 'rtl',
        lang: 'ar',
      })
    );
  }
});

// ─── Notification Click ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const url = event.notification.data?.url || '/';
  const notifType = event.notification.data?.type || 'system';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url,
              notifType,
            });
            return client.focus();
          }
        }
        const deeplinkUrl = '/?deeplink=' + encodeURIComponent(url);
        return self.clients.openWindow(deeplinkUrl);
      })
  );
});

self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification.tag);
});

