const CACHE_NAME = 'revproj-phone-v1';
const URLS_TO_CACHE = [
  '/phone',
  '/phone/css/phone.css',
  '/phone/js/phoneApp.js',
  '/phone/js/examples/mapPhone.js',
  '/phone/js/examples/pongPhone.js',
  '/phone/manifest.json'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // Always network-first for socket.io and dynamic content
  if (event.request.url.includes('/socket.io')) return;
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});
