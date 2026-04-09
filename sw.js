// sw.js - Service Worker
const CACHE_NAME = 'job-tracker-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/dashboard',
  '/src/pages/app.html',
  '/src/pages/landing.html',
  '/src/lib/config.js',
  '/src/lib/xlsxbuilder.js',
  '/src/lib/resume-engine.js',
  '/src/lib/docx-bundle.js',
  '/src/lib/logger.js',
  '/src/scripts/app.js',
  '/src/scripts/sw-register.js',
  '/public/icons/icon48.png',
  '/public/icons/icon128.png',
  '/public/icons/icon192.png',
  '/public/icons/icon512.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Adding assets individually so one failure does not break the whole installation
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(err => console.warn('SW failed to cache:', url, err)))
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Network-First policy for HTML and Scripts to ensure users receive updates
  if (event.request.mode === 'navigate' || event.request.url.includes('.js') || event.request.url.includes('.html')) {
    event.respondWith(
      fetch(event.request).then(response => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return response;
      }).catch(() => caches.match(event.request))
    );
  } else {
    // Cache-First for images and static assets
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(netResponse => {
          const resClone = netResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return netResponse;
        });
      }).catch(() => fetch(event.request))
    );
  }
});
