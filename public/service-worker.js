const CACHE_NAME = 'inktales-mobile-v12-company-main-redesign';
const APP_SHELL = [
  '/',
  '/index.html',
  '/company.html',
  '/product.html',
  '/app.html',
  '/offline.html',
  '/css/style.css',
  '/js/app.js',
  '/assets/logo.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/offline.html')))
  );
});
