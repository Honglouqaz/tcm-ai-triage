/* 离线缓存：装一次之后断网也能用 */
const CACHE = 'tcm-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'engine/tcm-engine.js', 'engine/rules-bundle.js', 'manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const cp = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
    return res;
  }).catch(() => caches.match('index.html'))));
});
