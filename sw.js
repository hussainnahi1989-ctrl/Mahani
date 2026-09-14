/* ===== Service Worker — يجعل التطبيق يعمل أوفلاين وقابل للتثبيت ===== */
const VERSION = 'mahani-v1';
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './config.js',
  './license-online.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];
const CDN_CACHE = 'mahani-cdn-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(PRECACHE.map(url => cache.add(url).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== CDN_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* صفحة التنقل: الشبكة أولاً، وإن تعذّرت فالنسخة المحفوظة */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(VERSION);
        return (await cache.match('./index.html')) || (await cache.match('./offline.html')) || Response.error();
      }
    })());
    return;
  }

  /* مكتبات Firebase من Google: تخزين ثم شبكة */
  if (url.origin.includes('gstatic.com') || url.origin.includes('googleapis.com')) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  /* ملفات الموقع: استخدم المحفوظ فوراً ثم حدّثه في الخلفية */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const network = fetch(req).then(fresh => {
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
        return fresh;
      }).catch(() => null);
      return hit || (await network) || Response.error();
    })());
  }
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
