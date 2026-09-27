/* KARDO service worker — ملفات الموقع فقط، لا يلمس الـ API ولا البيانات */
const V = 'kardo-v9-1';
const CORE = ['./', './index.html', './app.js', './config.js', './styles.css', './theme-desert.css', './kardo-v8.css', './kardo-v9.css', './icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const sameOrigin = u.origin === location.origin;
  const isFont = u.hostname === 'fonts.gstatic.com' || u.hostname === 'fonts.googleapis.com';
  const isSdk = u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/');
  if (isFont || isSdk) {                       // ثابتة بإصدارها → من الكاش أولًا
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    })));
    return;
  }
  if (!sameOrigin || u.pathname.endsWith('admin.html') || u.pathname.endsWith('admin.js')) return;
  e.respondWith(fetch(r).then(res => {         // ملفات الموقع → الشبكة أولًا (تحديثات فورية)، والكاش عند الانقطاع
    if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r).then(hit => hit || caches.match('./index.html'))));
});
