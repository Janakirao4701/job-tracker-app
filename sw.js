// sw.js - Basic Service Worker to satisfy PWA requirements
const CACHE_NAME = 'job-tracker-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/lib/config.js',
  '/lib/xlsxbuilder.js',
  '/scripts/app.js',
  '/scripts/templates.js',
  '/styles/sidebar.css',
  '/pwa-manifest.json',
  '/icons/icon48.png',
  '/icons/icon128.png',
  '/icons/icon192.png',
  '/icons/icon512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
