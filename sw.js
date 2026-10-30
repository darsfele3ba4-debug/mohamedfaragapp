/* Service Worker: يشغّل التطبيق بدون إنترنت. غيّر VERSION عند رفع تحديث للكود. */
const VERSION = 'sapp-v1';
const SHELL = ['./', 'index.html', 'config.js', 'css/style.css', 'js/store.js', 'js/app.js', 'manifest.json', 'logo.jpg', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return; // طلبات الـ API (POST) تذهب للشبكة مباشرة
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !isFont) return;
  // الشبكة أولاً ثم الكاش (يضمن وصول التحديثات، ويعمل بدون إنترنت)
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
