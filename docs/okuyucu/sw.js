// SciLex Okuyucu: internetsiz çalışma ve Android'de "Paylaş" ile gelen paketleri alma.
const VERSION = 'scilex-okuyucu-v2';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'unzip.js', 'store.js', 'manifest.webmanifest',
               'icon-192.png', 'icon-512.png'];
const MATHJAX = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/';

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== 'scilex-share' && k !== 'scilex-cdn'; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share')) {
    ev.respondWith((async function () {
      try {
        const form = await req.formData();
        const file = form.get('file');
        if (file) {
          const cache = await caches.open('scilex-share');
          await cache.put('shared-file', new Response(file));
        }
      } catch (e) {}
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (req.url.indexOf(MATHJAX) === 0) {
    // MathJax: önbellekten, yoksa ağdan alıp sakla.
    ev.respondWith(caches.open('scilex-cdn').then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/ornek/') >= 0) return;   // büyük örnek paket: önbelleğe alınmaz (IndexedDB'ye eklenir)
  // Uygulama dosyaları: önce ağ (güncel sürüm), internet yoksa önbellek.
  ev.respondWith(fetch(req).then(function (res) {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
  }));
});
