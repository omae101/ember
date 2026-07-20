// Ember PWA service worker (네트워크 우선, 실패 시 캐시)
const CACHE = 'ember-v14';
const CORE = ['/', '/index.html', '/app.html', '/install.html', '/ember-sync.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || !r.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(r).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)).catch(() => {}); return res; })
      .catch(() => caches.match(r).then((h) => h || caches.match('/')))
  );
});
