// Service Worker for 小说站 PWA
const CACHE_NAME = 'novel-site-v8';
const APP_SHELL = ['/style.css?v=20260430c', '/tag-search.js?v=20260430', '/manifest.json', '/icon.svg'];
const HTML_PATHS = new Set(['/', '/index', '/index.html', '/book', '/book.html', '/read', '/read.html']);

function isHtmlRequest(request, url) {
  const accept = request.headers.get('accept') || '';
  return request.mode === 'navigate' || accept.includes('text/html') || HTML_PATHS.has(url.pathname);
}

function putInCache(request, response) {
  if (!response || !response.ok) return;
  const clone = response.clone();
  caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
}

// Install: cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategies
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET
  if (e.request.method !== 'GET') return;

  // Admin API: always network (no caching)
  if (url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/auth')) return;

  // HTML: Network First，避免部署后页面长期停留在旧缓存
  if (isHtmlRequest(e.request, url)) {
    e.respondWith(
      fetch(e.request).then(res => {
        putInCache(e.request, res);
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/')))
    );
    return;
  }

  // Cover images: Cache First
  if (url.pathname.startsWith('/api/covers/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          putInCache(e.request, res);
          return res;
        });
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // API requests: Network First + Cache Fallback
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        putInCache(e.request, res);
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: Stale-While-Revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        putInCache(e.request, res);
        return res;
      });
      return cached || network;
    }).catch(() => caches.match('/'))
  );
});
