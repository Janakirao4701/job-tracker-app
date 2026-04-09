// sw.js - Service Worker
const CACHE_NAME = 'job-tracker-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
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
  self.skipWaiting();
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
  // Simple cache-first policy
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    }).catch(() => fetch(event.request))
  );
});
