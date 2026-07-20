// Ember PWA service worker (네트워크 우선, 실패 시 캐시)
const CACHE = 'ember-v30';
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
  // HTML 문서(화면 이동)는 항상 최신을 네트워크에서 강제로 받아 캐시 밀림 방지
  const isDoc = r.mode === 'navigate' || (r.headers.get('accept') || '').indexOf('text/html') !== -1;
  const req = isDoc ? new Request(r.url, { cache: 'no-store' }) : r;
  e.respondWith(
    fetch(req).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)).catch(() => {}); return res; })
      .catch(() => caches.match(r).then((h) => h || caches.match('/')))
  );
});
