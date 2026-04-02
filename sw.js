// sw.js - Basic Service Worker to satisfy PWA requirements
const CACHE_NAME = 'job-tracker-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/lib/config.js',
  '/lib/xlsxbuilder.js',
  '/scripts/app.js',
  '/styles/sidebar.css',
  '/icons/icon192.png',
  '/icons/icon512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});
